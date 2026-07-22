import "server-only";

import { and, asc, eq, isNull, max, sql } from "drizzle-orm";

import { db } from "@/db/client";
import { nodes, user } from "@/db/schema";
import type { CreateNodeInput, UpdateNodeInput } from "@/lib/nodes/contracts";
import { assembleNodeTree, type FlatNode } from "@/lib/nodes/tree";

export class NodeMutationError extends Error {
  constructor(
    public readonly reason: "node-not-found" | "parent-not-found" | "position-conflict",
  ) {
    super(reason);
    this.name = "NodeMutationError";
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

export async function getDashboardDataForUser(userId: string) {
  const rows = await db
    .select()
    .from(nodes)
    .where(eq(nodes.userId, userId))
    .orderBy(asc(nodes.position), asc(nodes.id));
  const flatNodes = rows.map(toFlatNode);
  const tree = assembleNodeTree(flatNodes);

  return {
    nodes: flatNodes,
    roots: tree.roots,
    orderedNodes: tree.ordered,
  };
}

export async function createNodeForUser(userId: string, input: CreateNodeInput) {
  try {
    return await db.transaction(async (tx) => {
      await tx.execute(sql`select ${user.id} from ${user} where ${user.id} = ${userId} for update`);

      const parentId = input.parentId ?? null;
      if (parentId !== null) {
        const [parent] = await tx
          .select({ id: nodes.id })
          .from(nodes)
          .where(and(eq(nodes.id, parentId), eq(nodes.userId, userId)))
          .limit(1);

        if (!parent) {
          throw new NodeMutationError("parent-not-found");
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
