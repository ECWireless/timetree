"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type {
  CreateNodeInput,
  MoveNodeInput,
  NodeActionResult,
  NodeIdInput,
  UpdateNodeInput,
} from "@/lib/nodes/contracts";
import { requireAuthorizedSession } from "@/lib/server/authorization";
import {
  createNodeForUser,
  completeNodeForUser,
  deleteNodeForUser,
  moveNodeForUser,
  NodeMutationError,
  reopenNodeForUser,
  updateNodeForUser,
} from "@/lib/server/node-service";

const titleSchema = z.string().trim().min(1, "Enter a title.").max(200, "Use 200 characters or fewer.");

const createNodeSchema = z.object({
  title: titleSchema,
  parentId: z.uuid().nullable().optional(),
});

const updateNodeSchema = z
  .object({
    id: z.uuid(),
    title: titleSchema.optional(),
    description: z
      .string()
      .trim()
      .max(4_000, "Use 4,000 characters or fewer.")
      .nullable()
      .optional()
      .transform((value) => (value === "" ? null : value)),
    hourlyRateCents: z
      .int()
      .min(0)
      .max(2_147_483_647, "The hourly rate is too large.")
      .nullable()
      .optional(),
  })
  .refine(
    (input) =>
      input.title !== undefined ||
      input.description !== undefined ||
      input.hourlyRateCents !== undefined,
    { message: "No changes were supplied." },
  );

const moveNodeSchema = z.object({
  id: z.uuid(),
  parentId: z.uuid().nullable(),
  position: z.int().min(0).optional(),
});

const nodeIdSchema = z.object({ id: z.uuid() });

function validationFailure(error: z.ZodError): NodeActionResult {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0]?.toString() ?? "form";
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
  }

  return { ok: false, message: "Check the highlighted fields.", fieldErrors };
}

function mutationFailure(error: unknown): NodeActionResult {
  if (error instanceof NodeMutationError) {
    switch (error.reason) {
      case "active-timers":
        return {
          ok: false,
          message: "Stop the running timers in this subtree first.",
          blockingNodeIds: error.blockingNodeIds,
        };
      case "cycle":
        return { ok: false, message: "A node cannot be moved inside its own subtree." };
      case "history-exists":
        return {
          ok: false,
          message: "This subtree contains time history and cannot be deleted. Complete it instead.",
          blockingNodeIds: error.blockingNodeIds,
        };
      case "invalid-position":
        return { ok: false, message: "That destination changed. Choose a position again." };
      case "node-completed":
        return { ok: false, message: "Reopen this node before starting a timer." };
      case "node-not-found":
        return { ok: false, message: "That node is no longer available." };
      case "parent-completed":
        return {
          ok: false,
          message: "Reopen the destination before adding or moving a node there.",
        };
      case "parent-not-found":
        return { ok: false, message: "That parent node is no longer available." };
      case "position-conflict":
        return { ok: false, message: "The node order changed. Please try again." };
    }
  }

  throw error;
}

export async function createNode(input: CreateNodeInput): Promise<NodeActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = createNodeSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const created = await createNodeForUser(session.user.id, parsed.data);
    revalidatePath("/");
    return { ok: true, nodeId: created.id };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function updateNode(input: UpdateNodeInput): Promise<NodeActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = updateNodeSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const updated = await updateNodeForUser(session.user.id, parsed.data);
    revalidatePath("/");
    return { ok: true, nodeId: updated.id };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function moveNode(input: MoveNodeInput): Promise<NodeActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = moveNodeSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const moved = await moveNodeForUser(session.user.id, parsed.data);
    revalidatePath("/");
    return { ok: true, nodeId: moved.id };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function completeNode(input: NodeIdInput): Promise<NodeActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = nodeIdSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const completed = await completeNodeForUser(session.user.id, parsed.data.id);
    revalidatePath("/");
    return { ok: true, nodeId: completed.id };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function reopenNode(input: NodeIdInput): Promise<NodeActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = nodeIdSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const reopened = await reopenNodeForUser(session.user.id, parsed.data.id);
    revalidatePath("/");
    return { ok: true, nodeId: reopened.id };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function deleteNode(input: NodeIdInput): Promise<NodeActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = nodeIdSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const deleted = await deleteNodeForUser(session.user.id, parsed.data.id);
    revalidatePath("/");
    return { ok: true, nodeId: deleted.nodeId };
  } catch (error) {
    return mutationFailure(error);
  }
}
