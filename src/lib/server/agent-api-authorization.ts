import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { agentApiKeys, user } from "@/db/schema";
import { isAllowedIdentity } from "@/lib/auth/policy";
import type { AgentApiKeyAccessLevel } from "@/lib/agent/contracts";
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
  accessLevel: AgentApiKeyAccessLevel;
  nodes: readonly FlatNode[];
  scopeNodeIds: ReadonlySet<string>;
};

function parseBearerKey(authorizationHeader: string | null) {
  const match = authorizationHeader?.match(/^Bearer ([^\s]+)$/i);
  return match ? parseAgentApiKey(match[1]) : null;
}

function isAgentApiKeyAccessLevel(
  value: string,
): value is AgentApiKeyAccessLevel {
  return value === "read_only" || value === "read_write";
}

function isVersionCompatibleWithAccessLevel(
  version: "v1" | "v2",
  accessLevel: AgentApiKeyAccessLevel,
) {
  return version === "v2" || accessLevel === "read_write";
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
      accessLevel: agentApiKeys.accessLevel,
      secretHash: agentApiKeys.secretHash,
    })
    .from(agentApiKeys)
    .where(eq(agentApiKeys.id, parsed.credentialId))
    .limit(1);
  if (
    !candidate ||
    !isAgentApiKeyAccessLevel(candidate.accessLevel) ||
    !isVersionCompatibleWithAccessLevel(parsed.version, candidate.accessLevel) ||
    !verifyAgentApiKeySecret(
      parsed.version,
      parsed.secretBytes,
      candidate.secretHash,
    )
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
      credential.accessLevel !== candidate.accessLevel ||
      !isAgentApiKeyAccessLevel(credential.accessLevel) ||
      !isVersionCompatibleWithAccessLevel(parsed.version, credential.accessLevel) ||
      !verifyAgentApiKeySecret(
        parsed.version,
        parsed.secretBytes,
        credential.secretHash,
      )
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
      accessLevel: credential.accessLevel,
      nodes: lockedNodes,
      scopeNodeIds,
    });
  });
}

export function requireAgentWriteAccess(context: AuthorizedAgentContext) {
  if (context.accessLevel !== "read_write") {
    throw new AgentApiError("insufficient-scope");
  }
}
