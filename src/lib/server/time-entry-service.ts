import "server-only";

import { and, desc, eq, getTableColumns, lt, or, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { nodes, timeEntries } from "@/db/schema";
import type {
  TimeEntryCursor,
  TimeEntryPage,
  TimeEntryRecord,
} from "@/lib/time-entries/contracts";

const PAGE_SIZE = 50;

type PreparedTimeEntryCommon = {
  nodeId: string;
  notes: string | null;
  hourlyRateCents?: number | null;
};

export type PreparedTimeEntryInput = PreparedTimeEntryCommon & {
  workDate: string;
  startedAt: Date | null;
  endedAt: Date | null;
  durationSeconds: number;
};

export type PreparedTimeEntryUpdate = PreparedTimeEntryCommon &
  (
    | {
        mode: "duration";
        workDate: string;
        durationSeconds: number;
      }
    | {
        mode: "range";
        start:
          | { kind: "preserve" }
          | { kind: "replace"; value: Date; workDate: string };
        end: { kind: "preserve" } | { kind: "replace"; value: Date };
      }
  );

type TimeEntryMutationReason = "entry-not-found" | "invalid-range" | "node-not-found";

export class TimeEntryMutationError extends Error {
  constructor(public readonly reason: TimeEntryMutationReason) {
    super(reason);
    this.name = "TimeEntryMutationError";
  }
}

export function toTimeEntryRecord(row: typeof timeEntries.$inferSelect): TimeEntryRecord {
  return {
    id: row.id,
    nodeId: row.nodeId,
    workDate: row.workDate,
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    durationSeconds: row.durationSeconds,
    hourlyRateCents: row.hourlyRateCents,
    notes: row.notes,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

async function getOwnedNodeRates(userId: string, nodeId: string) {
  const result = await db.execute<{
    cycle_detected: boolean;
    hourly_rate_cents: number | null;
    node_exists: boolean;
  }>(sql`
    with recursive ancestors as (
      select
        ${nodes.id} as id,
        ${nodes.parentId} as parent_id,
        ${nodes.hourlyRateCents} as hourly_rate_cents,
        0 as depth,
        array[${nodes.id}]::uuid[] as visited_ids,
        false as cycle_detected
      from ${nodes}
      where ${nodes.userId} = ${userId} and ${nodes.id} = ${nodeId}

      union all

      select
        parent.id,
        parent.parent_id,
        parent.hourly_rate_cents,
        child.depth + 1,
        child.visited_ids || parent.id,
        parent.id = any(child.visited_ids)
      from ancestors child
      join ${nodes} parent
        on parent.id = child.parent_id and parent.user_id = ${userId}
      where child.hourly_rate_cents is null and not child.cycle_detected
    )
    select
      exists(select 1 from ancestors where depth = 0) as node_exists,
      coalesce(bool_or(cycle_detected), false) as cycle_detected,
      (
        select hourly_rate_cents
        from ancestors
        where hourly_rate_cents is not null
        order by depth
        limit 1
      ) as hourly_rate_cents
    from ancestors
  `);
  const resolved = result.rows[0];
  if (!resolved?.node_exists || resolved.cycle_detected) {
    throw new TimeEntryMutationError("node-not-found");
  }
  return resolved.hourly_rate_cents;
}

async function requireOwnedNode(userId: string, nodeId: string) {
  const [node] = await db
    .select({ id: nodes.id })
    .from(nodes)
    .where(and(eq(nodes.userId, userId), eq(nodes.id, nodeId)))
    .limit(1);
  if (!node) {
    throw new TimeEntryMutationError("node-not-found");
  }
}

export async function getNodeEntriesForUser(
  userId: string,
  nodeId: string,
  cursor?: TimeEntryCursor,
): Promise<TimeEntryPage> {
  await requireOwnedNode(userId, nodeId);
  const cursorTimestamp = cursor ? sql<Date>`${cursor.createdAt}::timestamptz` : null;
  const cursorCondition =
    cursor && cursorTimestamp
      ? or(
          lt(timeEntries.createdAt, cursorTimestamp),
          and(eq(timeEntries.createdAt, cursorTimestamp), lt(timeEntries.id, cursor.id)),
        )
      : undefined;
  const rows = await db
    .select({
      ...getTableColumns(timeEntries),
      cursorCreatedAt: sql<string>`to_char(${timeEntries.createdAt} at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`,
    })
    .from(timeEntries)
    .where(
      and(
        eq(timeEntries.userId, userId),
        eq(timeEntries.nodeId, nodeId),
        cursorCondition,
      ),
    )
    .orderBy(desc(timeEntries.createdAt), desc(timeEntries.id))
    .limit(PAGE_SIZE + 1);
  const visibleRows = rows.slice(0, PAGE_SIZE);
  const lastVisible = visibleRows.at(-1);

  return {
    entries: visibleRows.map(toTimeEntryRecord),
    nextCursor:
      rows.length > PAGE_SIZE && lastVisible
        ? { createdAt: lastVisible.cursorCreatedAt, id: lastVisible.id }
        : null,
  };
}

export async function createTimeEntryForUser(userId: string, input: PreparedTimeEntryInput) {
  const resolvedRate = await getOwnedNodeRates(userId, input.nodeId);
  const hourlyRateCents =
    input.hourlyRateCents === undefined ? resolvedRate : input.hourlyRateCents;
  const [created] = await db
    .insert(timeEntries)
    .values({
      userId,
      nodeId: input.nodeId,
      workDate: input.workDate,
      startedAt: input.startedAt,
      endedAt: input.endedAt,
      durationSeconds: input.durationSeconds,
      hourlyRateCents,
      notes: input.notes,
    })
    .returning();
  return toTimeEntryRecord(created);
}

export async function updateTimeEntryForUser(
  userId: string,
  entryId: string,
  input: PreparedTimeEntryUpdate,
) {
  return db.transaction(async (tx) => {
    const [targetNode] = await tx
      .select({ id: nodes.id })
      .from(nodes)
      .where(and(eq(nodes.userId, userId), eq(nodes.id, input.nodeId)))
      .limit(1);
    if (!targetNode) {
      throw new TimeEntryMutationError("node-not-found");
    }
    const [stored] = await tx
      .select()
      .from(timeEntries)
      .where(and(eq(timeEntries.userId, userId), eq(timeEntries.id, entryId)))
      .for("update")
      .limit(1);
    if (!stored) {
      throw new TimeEntryMutationError("entry-not-found");
    }

    const changes: Partial<typeof timeEntries.$inferInsert> = {
      nodeId: input.nodeId,
      notes: input.notes,
      updatedAt: new Date(),
    };
    if (input.mode === "duration") {
      changes.workDate = input.workDate;
      changes.startedAt = null;
      changes.endedAt = null;
      changes.durationSeconds = input.durationSeconds;
    } else {
      const startedAt = input.start.kind === "preserve" ? stored.startedAt : input.start.value;
      const endedAt = input.end.kind === "preserve" ? stored.endedAt : input.end.value;
      if (!startedAt || !endedAt) {
        throw new TimeEntryMutationError("invalid-range");
      }
      const durationSeconds = Math.floor((endedAt.getTime() - startedAt.getTime()) / 1_000);
      if (durationSeconds <= 0 || durationSeconds > 2_147_483_647) {
        throw new TimeEntryMutationError("invalid-range");
      }
      changes.workDate =
        input.start.kind === "preserve" ? stored.workDate : input.start.workDate;
      changes.startedAt = startedAt;
      changes.endedAt = endedAt;
      changes.durationSeconds = durationSeconds;
    }
    if (input.hourlyRateCents !== undefined) {
      changes.hourlyRateCents = input.hourlyRateCents;
    }

    const [updated] = await tx
      .update(timeEntries)
      .set(changes)
      .where(and(eq(timeEntries.userId, userId), eq(timeEntries.id, entryId)))
      .returning();
    return toTimeEntryRecord(updated);
  });
}

export async function deleteTimeEntryForUser(userId: string, entryId: string) {
  const [deleted] = await db
    .delete(timeEntries)
    .where(and(eq(timeEntries.userId, userId), eq(timeEntries.id, entryId)))
    .returning({ id: timeEntries.id });
  if (!deleted) {
    throw new TimeEntryMutationError("entry-not-found");
  }
  return deleted.id;
}
