import "server-only";

import { and, asc, eq, inArray, max } from "drizzle-orm";

import { activeTimers, nodes } from "@/db/schema";
import type {
  AgentActiveTimer,
  AgentNode,
  AgentTreeResponse,
  CreateAgentNodeInput,
  CreateAgentNodeResponse,
  StartAgentTimerInput,
  StartAgentTimerResponse,
  StopAgentTimerResponse,
} from "@/lib/agent/contracts";
import { getWorkDateInTimeZone } from "@/lib/agent/time-zone";
import { orderScopedAgentNodes } from "@/lib/agent/tree";
import type { FlatNode } from "@/lib/nodes/tree";
import type { AuthorizedAgentContext } from "@/lib/server/agent-api-authorization";
import { AgentApiError } from "@/lib/server/agent-api-errors";
import {
  insertActiveTimerForLockedNode,
  stopActiveTimerForLockedNode,
  TimerMutationError,
} from "@/lib/server/timer-service";

function toAgentActiveTimer(
  timer: typeof activeTimers.$inferSelect,
): AgentActiveTimer {
  return {
    startedAt: timer.startedAt.toISOString(),
    workDate: timer.workDate,
  };
}

async function getScopedActiveTimers(context: AuthorizedAgentContext) {
  const timerRows = await context.tx
    .select()
    .from(activeTimers)
    .where(
      and(
        eq(activeTimers.userId, context.userId),
        inArray(activeTimers.nodeId, [...context.scopeNodeIds]),
      ),
    )
    .orderBy(asc(activeTimers.startedAt), asc(activeTimers.id));
  return new Map(timerRows.map((timer) => [timer.nodeId, timer]));
}

function toAgentNode(
  node: FlatNode,
  rootNodeId: string,
  timer: typeof activeTimers.$inferSelect | null,
): AgentNode {
  return {
    id: node.id,
    parentId: node.id === rootNodeId ? null : node.parentId,
    title: node.title,
    description: node.description,
    completedAt: node.completedAt,
    activeTimer: timer ? toAgentActiveTimer(timer) : null,
  };
}

function requireScopedNode(context: AuthorizedAgentContext, nodeId: string) {
  if (!context.scopeNodeIds.has(nodeId)) {
    throw new AgentApiError("not-found");
  }
  const node = context.nodes.find(({ id }) => id === nodeId);
  if (!node) {
    throw new AgentApiError("not-found");
  }
  return node;
}

function isConstraint(error: unknown, constraint: string) {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if (
      "code" in current &&
      current.code === "23505" &&
      "constraint" in current &&
      current.constraint === constraint
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export async function getAgentTree(
  context: AuthorizedAgentContext,
): Promise<AgentTreeResponse> {
  const timers = await getScopedActiveTimers(context);
  return {
    rootId: context.rootNodeId,
    nodes: orderScopedAgentNodes(
      context.nodes,
      context.rootNodeId,
      context.scopeNodeIds,
    ).map((node) =>
      toAgentNode(node, context.rootNodeId, timers.get(node.id) ?? null),
    ),
  };
}

export async function createAgentNode(
  context: AuthorizedAgentContext,
  input: CreateAgentNodeInput,
): Promise<CreateAgentNodeResponse> {
  const existing = context.nodes.find(({ id }) => id === input.id);
  if (existing) {
    if (!context.scopeNodeIds.has(existing.id)) {
      throw new AgentApiError("node-id-conflict");
    }
    const [timer] = await context.tx
      .select()
      .from(activeTimers)
      .where(
        and(
          eq(activeTimers.userId, context.userId),
          eq(activeTimers.nodeId, existing.id),
        ),
      )
      .limit(1);
    return {
      status: "existing",
      node: toAgentNode(
        existing,
        context.rootNodeId,
        timer ?? null,
      ),
    };
  }

  const [outsideCollision] = await context.tx
    .select({ id: nodes.id })
    .from(nodes)
    .where(eq(nodes.id, input.id))
    .limit(1);
  if (outsideCollision) {
    throw new AgentApiError("node-id-conflict");
  }

  const parent = requireScopedNode(context, input.parentId);
  if (parent.completedAt !== null) {
    throw new AgentApiError("parent-completed");
  }

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const created = await context.tx.transaction(async (savepoint) => {
        const [positionResult] = await savepoint
          .select({ value: max(nodes.position) })
          .from(nodes)
          .where(
            and(
              eq(nodes.userId, context.userId),
              eq(nodes.parentId, parent.id),
            ),
          );
        const [row] = await savepoint
          .insert(nodes)
          .values({
            id: input.id,
            userId: context.userId,
            parentId: parent.id,
            position: (positionResult?.value ?? -1) + 1,
            title: input.title,
          })
          .returning();
        return row;
      });
      const node: FlatNode = {
        id: created.id,
        parentId: created.parentId,
        position: created.position,
        title: created.title,
        description: created.description,
        hourlyRateCents: created.hourlyRateCents,
        completedAt: created.completedAt?.toISOString() ?? null,
      };
      return {
        status: "created",
        node: toAgentNode(node, context.rootNodeId, null),
      };
    } catch (error) {
      if (isConstraint(error, "nodes_pkey")) {
        throw new AgentApiError("node-id-conflict");
      }
      if (!isConstraint(error, "nodes_sibling_position_unique")) {
        throw error;
      }
    }
  }

  throw new AgentApiError("position-conflict");
}

export async function startAgentTimer(
  context: AuthorizedAgentContext,
  nodeId: string,
  input: StartAgentTimerInput,
  startedAt = new Date(),
): Promise<StartAgentTimerResponse> {
  const node = requireScopedNode(context, nodeId);
  const [existing] = await context.tx
    .select()
    .from(activeTimers)
    .where(
      and(
        eq(activeTimers.userId, context.userId),
        eq(activeTimers.nodeId, node.id),
      ),
    )
    .for("update")
    .limit(1);
  if (existing) {
    return {
      nodeId,
      status: "already-running",
      activeTimer: toAgentActiveTimer(existing),
    };
  }
  if (node.completedAt !== null) {
    throw new AgentApiError("node-completed");
  }

  const workDate = getWorkDateInTimeZone(startedAt, input.timeZone);
  try {
    const created = await context.tx.transaction((savepoint) =>
      insertActiveTimerForLockedNode(
        savepoint,
        context.userId,
        node,
        context.nodes,
        workDate,
        startedAt,
      ),
    );
    return {
      nodeId,
      status: "started",
      activeTimer: toAgentActiveTimer(created),
    };
  } catch (error) {
    if (!isConstraint(error, "active_timers_user_node_unique")) {
      throw error;
    }
    const [raced] = await context.tx
      .select()
      .from(activeTimers)
      .where(
        and(
          eq(activeTimers.userId, context.userId),
          eq(activeTimers.nodeId, node.id),
        ),
      )
      .for("update")
      .limit(1);
    if (!raced) {
      throw error;
    }
    return {
      nodeId,
      status: "already-running",
      activeTimer: toAgentActiveTimer(raced),
    };
  }
}

export async function stopAgentTimer(
  context: AuthorizedAgentContext,
  nodeId: string,
  endedAt = new Date(),
): Promise<StopAgentTimerResponse> {
  requireScopedNode(context, nodeId);
  try {
    const stopped = await stopActiveTimerForLockedNode(
      context.tx,
      context.userId,
      nodeId,
      endedAt,
    );
    return {
      nodeId,
      status: stopped ? "stopped" : "not-running",
    };
  } catch (error) {
    if (error instanceof TimerMutationError && error.reason === "timer-too-long") {
      throw new AgentApiError("timer-too-long");
    }
    throw error;
  }
}
