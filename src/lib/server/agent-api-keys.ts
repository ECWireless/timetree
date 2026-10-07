import "server-only";

import { z } from "zod";

import { requireAuthorizedSession } from "@/lib/server/authorization";
import {
  AgentApiKeyMutationError,
  getAgentApiKeyMetadataForUser,
  listAgentApiKeyMetadataForUser,
} from "@/lib/server/agent-api-key-service";

const nodeIdSchema = z.uuid();

export async function getAgentApiKeyMetadata(nodeId: string) {
  const session = await requireAuthorizedSession();
  const parsed = nodeIdSchema.safeParse(nodeId);
  if (!parsed.success) {
    throw new AgentApiKeyMutationError("node-not-found");
  }
  return getAgentApiKeyMetadataForUser(session.user.id, parsed.data);
}

export async function listAgentApiKeyMetadata(nodeId: string) {
  const session = await requireAuthorizedSession();
  const parsed = nodeIdSchema.safeParse(nodeId);
  if (!parsed.success) {
    throw new AgentApiKeyMutationError("node-not-found");
  }
  return listAgentApiKeyMetadataForUser(session.user.id, parsed.data);
}
