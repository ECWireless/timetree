import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { activeTimers, timeEntries } from "@/db/schema";
import type { FlatNode } from "@/lib/nodes/tree";
import { withLockedIncompleteNodeForUser } from "@/lib/server/node-service";
import type { ActiveTimerRecord } from "@/lib/timers/contracts";

const maximumDurationSeconds = 2_147_483_647;

type TimerMutationReason =
  | "already-running"
  | "node-completed"
  | "node-not-found"
  | "timer-not-found"
  | "timer-too-long";

export class TimerMutationError extends Error {
  constructor(public readonly reason: TimerMutationReason) {
    super(reason);
    this.name = "TimerMutationError";
  }
}

function toActiveTimerRecord(row: typeof activeTimers.$inferSelect): ActiveTimerRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    startedAt: row.startedAt.toISOString(),
    workDate: row.workDate,
    hourlyRateCents: row.hourlyRateCents,
  };
}

function resolveRate(target: FlatNode, allNodes: readonly FlatNode[]) {
  const byId = new Map(allNodes.map((node) => [node.id, node]));
  const visited = new Set<string>();
  let current: FlatNode | undefined = target;

  while (current) {
    if (visited.has(current.id)) {
      throw new TimerMutationError("node-not-found");
    }
    visited.add(current.id);
    if (current.hourlyRateCents !== null) {
      return current.hourlyRateCents;
    }
    if (current.parentId === null) {
      return null;
    }
    current = byId.get(current.parentId);
    if (current === undefined) {
      throw new TimerMutationError("node-not-found");
    }
  }

  return null;
}

function isDuplicateTimer(error: unknown) {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if (
      "code" in current &&
      current.code === "23505" &&
      "constraint" in current &&
      current.constraint === "active_timers_user_node_unique"
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export async function startTimerForUser(
  userId: string,
  nodeId: string,
  workDate: string,
  startedAt = new Date(),
) {
  try {
    return await withLockedIncompleteNodeForUser(
      userId,
      nodeId,
      async ({ insertActiveTimer, node, nodes }) =>
        toActiveTimerRecord(
          await insertActiveTimer({
            startedAt,
            workDate,
            hourlyRateCents: resolveRate(node, nodes),
          }),
        ),
    );
  } catch (error) {
    if (isDuplicateTimer(error)) {
      throw new TimerMutationError("already-running");
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "reason" in error &&
      (error.reason === "node-completed" || error.reason === "node-not-found")
    ) {
      throw new TimerMutationError(error.reason);
    }
    throw error;
  }
}

export async function stopTimerForUser(userId: string, timerId: string, endedAt = new Date()) {
  return db.transaction(async (tx) => {
    const [timer] = await tx
      .select()
      .from(activeTimers)
      .where(and(eq(activeTimers.userId, userId), eq(activeTimers.id, timerId)))
      .for("update")
      .limit(1);
    if (!timer) {
      throw new TimerMutationError("timer-not-found");
    }

    const elapsedMilliseconds = endedAt.getTime() - timer.startedAt.getTime();
    const durationSeconds = Math.max(1, Math.floor(elapsedMilliseconds / 1_000));
    if (elapsedMilliseconds < 0 || durationSeconds > maximumDurationSeconds) {
      throw new TimerMutationError(
        durationSeconds > maximumDurationSeconds ? "timer-too-long" : "timer-not-found",
      );
    }
    const recordedEndedAt =
      elapsedMilliseconds < 1_000
        ? new Date(timer.startedAt.getTime() + 1_000)
        : endedAt;

    const [entry] = await tx
      .insert(timeEntries)
      .values({
        userId,
        nodeId: timer.nodeId,
        workDate: timer.workDate,
        startedAt: timer.startedAt,
        endedAt: recordedEndedAt,
        durationSeconds,
        hourlyRateCents: timer.hourlyRateCents,
        notes: null,
      })
      .returning({ id: timeEntries.id });
    await tx
      .delete(activeTimers)
      .where(and(eq(activeTimers.userId, userId), eq(activeTimers.id, timer.id)));

    return { timerId: timer.id, entryId: entry.id };
  });
}
