import "server-only";

import { and, asc, eq, getTableColumns, gte, inArray, isNull, lt, max, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { activeTimers, agentApiKeys, nodes, timeEntries, user } from "@/db/schema";
import type { CreateNodeInput, MoveNodeInput, UpdateNodeInput } from "@/lib/nodes/contracts";
import { assembleNodeTree, type FlatNode } from "@/lib/nodes/tree";
import {
  resolveDashboardPeriod,
  type DashboardPeriodInput,
} from "@/lib/time-entries/period";
import type { ActiveTimerRecord } from "@/lib/timers/contracts";

export type NodeTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

type ActiveTimerInsert = Pick<
  typeof activeTimers.$inferInsert,
  "hourlyRateCents" | "startedAt" | "workDate"
>;

type LockedNodeOperation<T> = (context: {
  insertActiveTimer: (input: ActiveTimerInsert) => Promise<typeof activeTimers.$inferSelect>;
  node: FlatNode;
  nodes: readonly FlatNode[];
}) => Promise<T>;

type NodeMutationReason =
  | "active-timers"
  | "cycle"
  | "history-exists"
  | "invalid-position"
  | "node-completed"
  | "node-not-found"
  | "parent-completed"
  | "parent-not-found"
  | "position-conflict";

export class NodeMutationError extends Error {
  constructor(
    public readonly reason: NodeMutationReason,
    public readonly blockingNodeIds: readonly string[] = [],
  ) {
    super(reason);
    this.name = "NodeMutationError";
  }
}

function getDeletionConflictReason(error: unknown) {
  if (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23503" &&
    "constraint" in error
  ) {
    if (error.constraint === "active_timers_node_owner_fk") {
      return "active-timers" as const;
    }
    if (error.constraint === "time_entries_node_owner_fk") {
      return "history-exists" as const;
    }
  }
  return null;
}

export async function lockOwnerNodes(tx: NodeTransaction, userId: string) {
  await tx.execute(sql`select ${user.id} from ${user} where ${user.id} = ${userId} for update`);
  const rows = await tx
    .select()
    .from(nodes)
    .where(eq(nodes.userId, userId))
    .orderBy(asc(nodes.id))
    .for("update");

  return rows.map(toFlatNode);
}

function requireNode(lockedNodes: readonly FlatNode[], nodeId: string) {
  const node = lockedNodes.find(({ id }) => id === nodeId);
  if (!node) {
    throw new NodeMutationError("node-not-found");
  }
  return node;
}

function getSubtreeIds(lockedNodes: readonly FlatNode[], rootId: string) {
  const childrenByParent = new Map<string, string[]>();
  for (const node of lockedNodes) {
    if (node.parentId !== null) {
      const childIds = childrenByParent.get(node.parentId) ?? [];
      childIds.push(node.id);
      childrenByParent.set(node.parentId, childIds);
    }
  }

  const result: string[] = [];
  const visited = new Set<string>();
  const work = [rootId];
  while (work.length > 0) {
    const nodeId = work.pop();
    if (!nodeId) {
      break;
    }
    if (visited.has(nodeId)) {
      throw new NodeMutationError("cycle");
    }
    visited.add(nodeId);
    result.push(nodeId);
    work.push(...(childrenByParent.get(nodeId) ?? []));
  }
  return result;
}

function getAncestorPathIds(lockedNodes: readonly FlatNode[], node: FlatNode) {
  const byId = new Map(lockedNodes.map((candidate) => [candidate.id, candidate]));
  const result: string[] = [];
  const visited = new Set<string>();
  let current: FlatNode | undefined = node;

  while (current) {
    if (visited.has(current.id)) {
      throw new NodeMutationError("cycle");
    }
    visited.add(current.id);
    result.push(current.id);
    current = current.parentId === null ? undefined : byId.get(current.parentId);
  }

  return result;
}

async function rewriteSiblingGroup(
  tx: NodeTransaction,
  userId: string,
  siblings: readonly FlatNode[],
  parentId: string | null,
) {
  for (let position = 0; position < siblings.length; position += 1) {
    const sibling = siblings[position];
    if (sibling.parentId !== parentId || sibling.position !== position) {
      await tx
        .update(nodes)
        .set({ parentId, position, updatedAt: new Date() })
        .where(and(eq(nodes.userId, userId), eq(nodes.id, sibling.id)));
    }
  }
}

function toFlatNode(row: typeof nodes.$inferSelect): FlatNode {
  return {
    id: row.id,
    parentId: row.parentId,
    position: row.position,
    title: row.title,
    description: row.description,
    hourlyRateCents: row.hourlyRateCents,
    completedAt: row.completedAt?.toISOString() ?? null,
  };
}

function isSiblingPositionConflict(error: unknown) {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "23505" &&
    "constraint" in error &&
    error.constraint === "nodes_sibling_position_unique"
  );
}

export async function getDashboardDataForUser(
  userId: string,
  periodInput: DashboardPeriodInput = { mode: "all" },
  afterHistoricalRead?: () => Promise<void>,
) {
  const period = resolveDashboardPeriod(periodInput);
  return db.transaction(async (tx) => {
    const entryPredicate =
      period.mode === "all"
        ? eq(timeEntries.userId, userId)
        : and(
            eq(timeEntries.userId, userId),
            gte(timeEntries.workDate, period.startDate),
            lt(timeEntries.workDate, period.endDateExclusive),
          );
    const directEntryAggregates = tx
    .select({
      nodeId: timeEntries.nodeId,
      durationSeconds: sql<string>`sum(${timeEntries.durationSeconds}::bigint)::text`.as(
        "duration_seconds",
      ),
      pricedValueNumerator:
        sql<string>`coalesce(sum(${timeEntries.durationSeconds}::numeric * ${timeEntries.hourlyRateCents}::numeric), 0)::text`.as(
          "priced_value_numerator",
        ),
      hasUnpricedTime: sql<boolean>`bool_or(${timeEntries.hourlyRateCents} is null)`.as(
        "has_unpriced_time",
      ),
      hasPricedTime: sql<boolean>`bool_or(${timeEntries.hourlyRateCents} is not null)`.as(
        "has_priced_time",
      ),
    })
    .from(timeEntries)
    .where(entryPredicate)
    .groupBy(timeEntries.nodeId)
    .as("direct_entry_aggregates");
    const rows = await tx
    .select({
      ...getTableColumns(nodes),
      directDurationSeconds: directEntryAggregates.durationSeconds,
      directPricedValueNumerator: directEntryAggregates.pricedValueNumerator,
      hasDirectUnpricedTime: directEntryAggregates.hasUnpricedTime,
      hasDirectPricedTime: directEntryAggregates.hasPricedTime,
    })
    .from(nodes)
    .leftJoin(directEntryAggregates, eq(nodes.id, directEntryAggregates.nodeId))
    .where(eq(nodes.userId, userId))
    .orderBy(asc(nodes.position), asc(nodes.id));
    // This optional synchronization seam lets integration tests pause the real
    // dashboard transaction at the snapshot boundary without changing runtime behavior.
    await afterHistoricalRead?.();
    const timerRows = await tx
    .select()
    .from(activeTimers)
    .where(eq(activeTimers.userId, userId))
    .orderBy(asc(activeTimers.startedAt), asc(activeTimers.id));
    const flatNodes = rows.map(toFlatNode);
    const tree = assembleNodeTree(
      flatNodes,
      rows.flatMap((row) =>
        row.directDurationSeconds === null
          ? []
          : [
              {
                nodeId: row.id,
                durationSeconds: Number(row.directDurationSeconds),
                pricedValueNumerator: row.directPricedValueNumerator ?? "0",
                hasUnpricedTime: row.hasDirectUnpricedTime ?? false,
                hasPricedTime: row.hasDirectPricedTime ?? false,
              },
            ],
      ),
    );

    return {
      readAtMilliseconds: Date.now(),
      nodes: flatNodes,
      roots: tree.roots,
      orderedNodes: tree.ordered,
      activeTimers: timerRows.map(
        (timer): ActiveTimerRecord => ({
          id: timer.id,
          nodeId: timer.nodeId,
          startedAt: timer.startedAt.toISOString(),
          workDate: timer.workDate,
          hourlyRateCents: timer.hourlyRateCents,
        }),
      ),
    };
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
}

export async function createNodeForUser(userId: string, input: CreateNodeInput) {
  try {
    return await db.transaction(async (tx) => {
      const lockedNodes = await lockOwnerNodes(tx, userId);

      const parentId = input.parentId ?? null;
      if (parentId !== null) {
        const parent = lockedNodes.find(({ id }) => id === parentId);
        if (!parent) {
          throw new NodeMutationError("parent-not-found");
        }
        if (parent.completedAt !== null) {
          throw new NodeMutationError("parent-completed");
        }
      }

      const siblingCondition =
        parentId === null
          ? and(eq(nodes.userId, userId), isNull(nodes.parentId))
          : and(eq(nodes.userId, userId), eq(nodes.parentId, parentId));
      const [positionResult] = await tx
        .select({ value: max(nodes.position) })
        .from(nodes)
        .where(siblingCondition);
      const position = (positionResult?.value ?? -1) + 1;
      const [created] = await tx
        .insert(nodes)
        .values({
          userId,
          parentId,
          position,
          title: input.title,
        })
        .returning();

      return toFlatNode(created);
    });
  } catch (error) {
    if (isSiblingPositionConflict(error)) {
      throw new NodeMutationError("position-conflict");
    }
    throw error;
  }
}

export async function updateNodeForUser(userId: string, input: UpdateNodeInput) {
  const changes: Partial<typeof nodes.$inferInsert> = { updatedAt: new Date() };

  if (input.title !== undefined) {
    changes.title = input.title;
  }
  if (input.description !== undefined) {
    changes.description = input.description;
  }
  if (input.hourlyRateCents !== undefined) {
    changes.hourlyRateCents = input.hourlyRateCents;
  }

  const [updated] = await db
    .update(nodes)
    .set(changes)
    .where(and(eq(nodes.id, input.id), eq(nodes.userId, userId)))
    .returning();

  if (!updated) {
    throw new NodeMutationError("node-not-found");
  }

  return toFlatNode(updated);
}

export async function moveNodeForUser(userId: string, input: MoveNodeInput) {
  try {
    return await db.transaction(async (tx) => {
      const lockedNodes = await lockOwnerNodes(tx, userId);
      const source = requireNode(lockedNodes, input.id);
      let destination: FlatNode | null = null;
      if (input.parentId !== null) {
        destination = lockedNodes.find(({ id }) => id === input.parentId) ?? null;
        if (!destination) {
          throw new NodeMutationError("parent-not-found");
        }
      }
      if (
        input.parentId !== null &&
        new Set(getSubtreeIds(lockedNodes, source.id)).has(input.parentId)
      ) {
        throw new NodeMutationError("cycle");
      }
      if (source.completedAt === null && destination !== null && destination.completedAt !== null) {
        throw new NodeMutationError("parent-completed");
      }

      const sourceSiblings = lockedNodes
        .filter(({ parentId, id }) => parentId === source.parentId && id !== source.id)
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
      const destinationSiblings =
        source.parentId === input.parentId
          ? sourceSiblings
          : lockedNodes
              .filter(({ parentId }) => parentId === input.parentId)
              .sort(
                (left, right) => left.position - right.position || left.id.localeCompare(right.id),
              );
      const position = input.position ?? destinationSiblings.length;

      if (position < 0 || position > destinationSiblings.length) {
        throw new NodeMutationError("invalid-position");
      }

      const reorderedDestination = [...destinationSiblings];
      reorderedDestination.splice(position, 0, source);
      await tx.execute(sql`set constraints nodes_sibling_position_unique deferred`);

      if (source.parentId !== input.parentId) {
        await rewriteSiblingGroup(tx, userId, sourceSiblings, source.parentId);
      }
      await rewriteSiblingGroup(tx, userId, reorderedDestination, input.parentId);

      return {
        ...source,
        parentId: input.parentId,
        position,
      };
    });
  } catch (error) {
    if (isSiblingPositionConflict(error)) {
      throw new NodeMutationError("position-conflict");
    }
    throw error;
  }
}

export async function completeNodeForUser(userId: string, nodeId: string) {
  return db.transaction(async (tx) => {
    const lockedNodes = await lockOwnerNodes(tx, userId);
    const target = requireNode(lockedNodes, nodeId);
    const subtreeIds = getSubtreeIds(lockedNodes, nodeId);
    const timers = await tx
      .select({ nodeId: activeTimers.nodeId })
      .from(activeTimers)
      .where(and(eq(activeTimers.userId, userId), inArray(activeTimers.nodeId, subtreeIds)));

    if (timers.length > 0) {
      throw new NodeMutationError(
        "active-timers",
        timers.map(({ nodeId: blockingNodeId }) => blockingNodeId),
      );
    }

    const completedAt = new Date();
    await tx
      .update(nodes)
      .set({ completedAt, updatedAt: completedAt })
      .where(
        and(
          eq(nodes.userId, userId),
          inArray(nodes.id, subtreeIds),
          isNull(nodes.completedAt),
        ),
      );

    return {
      ...target,
      completedAt: target.completedAt ?? completedAt.toISOString(),
    };
  });
}

export async function reopenNodeForUser(userId: string, nodeId: string) {
  return db.transaction(async (tx) => {
    const lockedNodes = await lockOwnerNodes(tx, userId);
    const target = requireNode(lockedNodes, nodeId);
    const ancestorPathIds = getAncestorPathIds(lockedNodes, target);

    await tx
      .update(nodes)
      .set({ completedAt: null, updatedAt: new Date() })
      .where(and(eq(nodes.userId, userId), inArray(nodes.id, ancestorPathIds)));

    return { ...target, completedAt: null };
  });
}

export async function deleteNodeForUser(userId: string, nodeId: string) {
  try {
    return await db.transaction(async (tx) => {
      const lockedNodes = await lockOwnerNodes(tx, userId);
      const target = requireNode(lockedNodes, nodeId);
      const subtreeIds = getSubtreeIds(lockedNodes, nodeId);
      await tx
        .select({ id: agentApiKeys.id })
        .from(agentApiKeys)
        .where(
          and(
            eq(agentApiKeys.userId, userId),
            inArray(agentApiKeys.rootNodeId, subtreeIds),
          ),
        )
        .orderBy(asc(agentApiKeys.id))
        .for("update");
      const timers = await tx
        .select({ nodeId: activeTimers.nodeId })
        .from(activeTimers)
        .where(and(eq(activeTimers.userId, userId), inArray(activeTimers.nodeId, subtreeIds)));
      const entries = await tx
        .select({ nodeId: timeEntries.nodeId })
        .from(timeEntries)
        .where(and(eq(timeEntries.userId, userId), inArray(timeEntries.nodeId, subtreeIds)));

      if (timers.length > 0) {
        throw new NodeMutationError(
          "active-timers",
          timers.map(({ nodeId: blockingNodeId }) => blockingNodeId),
        );
      }
      if (entries.length > 0) {
        throw new NodeMutationError(
          "history-exists",
          entries.map(({ nodeId: blockingNodeId }) => blockingNodeId),
        );
      }

      await tx.execute(sql`set constraints nodes_sibling_position_unique deferred`);
      await tx
        .delete(nodes)
        .where(and(eq(nodes.userId, userId), eq(nodes.id, target.id)));
      const remainingSiblings = lockedNodes
        .filter(
          ({ parentId, id }) => parentId === target.parentId && !subtreeIds.includes(id),
        )
        .sort((left, right) => left.position - right.position || left.id.localeCompare(right.id));
      await rewriteSiblingGroup(tx, userId, remainingSiblings, target.parentId);

      return { nodeId };
    });
  } catch (error) {
    const conflictReason = getDeletionConflictReason(error);
    if (conflictReason !== null) {
      throw new NodeMutationError(conflictReason);
    }
    throw error;
  }
}

/**
 * Phase 6 timer starts use this boundary so lifecycle validation and timer
 * insertion happen while the same ordered node locks are held.
 */
export async function withLockedIncompleteNodeForUser<T>(
  userId: string,
  nodeId: string,
  operation: LockedNodeOperation<T>,
) {
  return db.transaction(async (tx) => {
    const lockedNodes = await lockOwnerNodes(tx, userId);
    const node = requireNode(lockedNodes, nodeId);
    if (node.completedAt !== null) {
      throw new NodeMutationError("node-completed");
    }
    return operation({
      node,
      nodes: lockedNodes,
      insertActiveTimer: async (input) => {
        const [created] = await tx
          .insert(activeTimers)
          .values({ ...input, userId, nodeId })
          .returning();
        return created;
      },
    });
  });
}
