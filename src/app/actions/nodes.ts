"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type {
  CreateNodeInput,
  NodeActionResult,
  UpdateNodeInput,
} from "@/lib/nodes/contracts";
import { requireAuthorizedSession } from "@/lib/server/authorization";
import {
  createNodeForUser,
  NodeMutationError,
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
    if (error.reason === "parent-not-found") {
      return { ok: false, message: "That parent node is no longer available." };
    }
    if (error.reason === "node-not-found") {
      return { ok: false, message: "That node is no longer available." };
    }
    return { ok: false, message: "The node order changed. Please try again." };
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
