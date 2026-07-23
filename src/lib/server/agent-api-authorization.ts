import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { agentApiKeys, user } from "@/db/schema";
import { isAllowedIdentity } from "@/lib/auth/policy";
import { AgentApiError } from "@/lib/server/agent-api-errors";
import { parseAgentApiKey, verifyAgentApiKeySecret } from "@/lib/server/agent-api-key-token";
import { getAllowedEmail } from "@/lib/server/allowed-email";
import {
  getSubtreeIds,
  lockOwnerNodes,
  type NodeTransaction,
} from "@/lib/server/node-service";
import type { FlatNode } from "@/lib/nodes/tree";

export type AuthorizedAgentContext = {
  tx: NodeTransaction;
  userId: string;
  rootNodeId: string;
  nodes: readonly FlatNode[];
  scopeNodeIds: ReadonlySet<string>;
};

function parseBearerKey(authorizationHeader: string | null) {
  const match = authorizationHeader?.match(/^Bearer ([^\s]+)$/i);
  return match ? parseAgentApiKey(match[1]) : null;
}

export async function withAuthorizedAgentKey<T>(
  authorizationHeader: string | null,
  operation: (context: AuthorizedAgentContext) => Promise<T>,
) {
  const parsed = parseBearerKey(authorizationHeader);
  if (!parsed) {
    throw new AgentApiError("invalid-key");
  }

  const [candidate] = await db
    .select({
      id: agentApiKeys.id,
      userId: agentApiKeys.userId,
      rootNodeId: agentApiKeys.rootNodeId,
      secretHash: agentApiKeys.secretHash,
    })
    .from(agentApiKeys)
    .where(eq(agentApiKeys.id, parsed.credentialId))
    .limit(1);
  if (
    !candidate ||
    !verifyAgentApiKeySecret(parsed.secretBytes, candidate.secretHash)
  ) {
    throw new AgentApiError("invalid-key");
  }

  return db.transaction(async (tx) => {
    const lockedNodes = await lockOwnerNodes(tx, candidate.userId);
    const [credential] = await tx
      .select()
      .from(agentApiKeys)
      .where(
        and(
          eq(agentApiKeys.id, candidate.id),
          eq(agentApiKeys.userId, candidate.userId),
        ),
      )
      .for("update")
      .limit(1);
    if (
      !credential ||
      credential.rootNodeId !== candidate.rootNodeId ||
      !verifyAgentApiKeySecret(parsed.secretBytes, credential.secretHash)
    ) {
      throw new AgentApiError("invalid-key");
    }

    const [owner] = await tx
      .select({
        email: user.email,
        emailVerified: user.emailVerified,
      })
      .from(user)
      .where(eq(user.id, candidate.userId))
      .limit(1);
    if (!owner || !isAllowedIdentity(owner, getAllowedEmail())) {
      throw new AgentApiError("invalid-key");
    }

    if (!lockedNodes.some(({ id }) => id === credential.rootNodeId)) {
      throw new AgentApiError("invalid-key");
    }
    const scopeNodeIds = new Set(
      getSubtreeIds(lockedNodes, credential.rootNodeId),
    );

    return operation({
      tx,
      userId: candidate.userId,
      rootNodeId: credential.rootNodeId,
      nodes: lockedNodes,
      scopeNodeIds,
    });
  });
}
