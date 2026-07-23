"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import type {
  AgentApiKeySecretActionResult,
  CreateAgentApiKeyInput,
  RevokeAgentApiKeyActionResult,
  RevokeAgentApiKeyInput,
  RotateAgentApiKeyInput,
} from "@/lib/agent/contracts";
import {
  AgentApiKeyMutationError,
  createAgentApiKeyForUser,
  revokeAgentApiKeyForUser,
  rotateAgentApiKeyForUser,
} from "@/lib/server/agent-api-key-service";
import { requireAuthorizedSession } from "@/lib/server/authorization";

const createSchema = z.object({ nodeId: z.uuid() });
const existingCredentialSchema = z.object({
  nodeId: z.uuid(),
  credentialId: z.uuid(),
});

function validationFailure(error: z.ZodError) {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const field = issue.path[0]?.toString() ?? "form";
    fieldErrors[field] = [...(fieldErrors[field] ?? []), issue.message];
  }
  return {
    ok: false as const,
    message: "Check the highlighted fields.",
    fieldErrors,
  };
}

function mutationFailure(error: unknown) {
  if (!(error instanceof AgentApiKeyMutationError)) {
    throw error;
  }

  switch (error.reason) {
    case "credential-already-exists":
      return {
        ok: false as const,
        message: "Agent access already exists for this node.",
      };
    case "credential-changed":
      return {
        ok: false as const,
        message: "Agent access changed. Refresh and try again.",
      };
    case "credential-not-found":
      return {
        ok: false as const,
        message: "Agent access is no longer available.",
      };
    case "node-not-found":
      return {
        ok: false as const,
        message: "That node is no longer available.",
      };
  }
}

export async function createAgentApiKey(
  input: CreateAgentApiKeyInput,
): Promise<AgentApiKeySecretActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = createSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const result = await createAgentApiKeyForUser(
      session.user.id,
      parsed.data.nodeId,
    );
    revalidatePath("/");
    return { ok: true, ...result };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function rotateAgentApiKey(
  input: RotateAgentApiKeyInput,
): Promise<AgentApiKeySecretActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = existingCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const result = await rotateAgentApiKeyForUser(
      session.user.id,
      parsed.data.nodeId,
      parsed.data.credentialId,
    );
    revalidatePath("/");
    return { ok: true, ...result };
  } catch (error) {
    return mutationFailure(error);
  }
}

export async function revokeAgentApiKey(
  input: RevokeAgentApiKeyInput,
): Promise<RevokeAgentApiKeyActionResult> {
  const session = await requireAuthorizedSession();
  const parsed = existingCredentialSchema.safeParse(input);
  if (!parsed.success) {
    return validationFailure(parsed.error);
  }

  try {
    const result = await revokeAgentApiKeyForUser(
      session.user.id,
      parsed.data.nodeId,
      parsed.data.credentialId,
    );
    revalidatePath("/");
    return { ok: true, ...result };
  } catch (error) {
    return mutationFailure(error);
  }
}
