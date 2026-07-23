import "server-only";

import { and, eq } from "drizzle-orm";

import { db } from "@/db/client";
import { agentApiKeys } from "@/db/schema";
import type { AgentApiKeyMetadata } from "@/lib/agent/contracts";
import {
  generateAgentApiKey,
  type ParsedAgentApiKey,
  verifyAgentApiKeySecret,
} from "@/lib/server/agent-api-key-token";
import {
  lockOwnerNodes,
  type NodeTransaction,
} from "@/lib/server/node-service";

type AgentApiKeyMutationReason =
  | "credential-already-exists"
  | "credential-changed"
  | "credential-not-found"
  | "node-not-found";

export class AgentApiKeyMutationError extends Error {
  constructor(public readonly reason: AgentApiKeyMutationReason) {
    super(reason);
    this.name = "AgentApiKeyMutationError";
  }
}

function toMetadata(row: typeof agentApiKeys.$inferSelect): AgentApiKeyMetadata {
  return {
    id: row.id,
    createdAt: row.createdAt.toISOString(),
  };
}

function requireLockedNode(
  lockedNodes: Awaited<ReturnType<typeof lockOwnerNodes>>,
  nodeId: string,
) {
  if (!lockedNodes.some(({ id }) => id === nodeId)) {
    throw new AgentApiKeyMutationError("node-not-found");
  }
}

async function lockCredentialForRoot(
  tx: NodeTransaction,
  userId: string,
  rootNodeId: string,
) {
  const [credential] = await tx
    .select()
    .from(agentApiKeys)
    .where(
      and(
        eq(agentApiKeys.userId, userId),
        eq(agentApiKeys.rootNodeId, rootNodeId),
      ),
    )
    .for("update")
    .limit(1);

  return credential ?? null;
}

function isUniqueCredentialConflict(error: unknown) {
  let current: unknown = error;
  while (typeof current === "object" && current !== null) {
    if (
      "code" in current &&
      current.code === "23505" &&
      "constraint" in current &&
      current.constraint === "agent_api_keys_user_root_unique"
    ) {
      return true;
    }
    current = "cause" in current ? current.cause : null;
  }
  return false;
}

export async function getAgentApiKeyMetadataForUser(userId: string, nodeId: string) {
  const [node] = await db.query.nodes.findMany({
    where: (table, { and: all, eq: equals }) =>
      all(equals(table.userId, userId), equals(table.id, nodeId)),
    columns: { id: true },
    limit: 1,
  });
  if (!node) {
    throw new AgentApiKeyMutationError("node-not-found");
  }

  const [credential] = await db
    .select()
    .from(agentApiKeys)
    .where(
      and(
        eq(agentApiKeys.userId, userId),
        eq(agentApiKeys.rootNodeId, nodeId),
      ),
    )
    .limit(1);

  return credential ? toMetadata(credential) : null;
}

export async function createAgentApiKeyForUser(userId: string, rootNodeId: string) {
  try {
    return await db.transaction(async (tx) => {
      const lockedNodes = await lockOwnerNodes(tx, userId);
      requireLockedNode(lockedNodes, rootNodeId);
      const existing = await lockCredentialForRoot(tx, userId, rootNodeId);
      if (existing) {
        throw new AgentApiKeyMutationError("credential-already-exists");
      }

      const generated = generateAgentApiKey();
      const [credential] = await tx
        .insert(agentApiKeys)
        .values({
          id: generated.credentialId,
          userId,
          rootNodeId,
          secretHash: generated.secretHash,
        })
        .returning();

      return {
        credential: toMetadata(credential),
        apiKey: generated.apiKey,
      };
    });
  } catch (error) {
    if (isUniqueCredentialConflict(error)) {
      throw new AgentApiKeyMutationError("credential-already-exists");
    }
    throw error;
  }
}

export async function rotateAgentApiKeyForUser(
  userId: string,
  rootNodeId: string,
  expectedCredentialId: string,
) {
  return db.transaction(async (tx) => {
    const lockedNodes = await lockOwnerNodes(tx, userId);
    requireLockedNode(lockedNodes, rootNodeId);
    const current = await lockCredentialForRoot(tx, userId, rootNodeId);
    if (!current) {
      throw new AgentApiKeyMutationError("credential-not-found");
    }
    if (current.id !== expectedCredentialId) {
      throw new AgentApiKeyMutationError("credential-changed");
    }

    const generated = generateAgentApiKey();
    await tx
      .delete(agentApiKeys)
      .where(
        and(
          eq(agentApiKeys.userId, userId),
          eq(agentApiKeys.id, expectedCredentialId),
        ),
      );
    const [credential] = await tx
      .insert(agentApiKeys)
      .values({
        id: generated.credentialId,
        userId,
        rootNodeId,
        secretHash: generated.secretHash,
      })
      .returning();

    return {
      credential: toMetadata(credential),
      apiKey: generated.apiKey,
    };
  });
}

export async function revokeAgentApiKeyForUser(
  userId: string,
  rootNodeId: string,
  expectedCredentialId: string,
) {
  return db.transaction(async (tx) => {
    const lockedNodes = await lockOwnerNodes(tx, userId);
    requireLockedNode(lockedNodes, rootNodeId);
    const current = await lockCredentialForRoot(tx, userId, rootNodeId);
    if (!current) {
      throw new AgentApiKeyMutationError("credential-not-found");
    }
    if (current.id !== expectedCredentialId) {
      throw new AgentApiKeyMutationError("credential-changed");
    }

    await tx
      .delete(agentApiKeys)
      .where(
        and(
          eq(agentApiKeys.userId, userId),
          eq(agentApiKeys.id, expectedCredentialId),
        ),
      );

    return { credentialId: expectedCredentialId };
  });
}

export function verifyParsedAgentApiKey(
  parsed: ParsedAgentApiKey,
  storedHash: string,
) {
  return verifyAgentApiKeySecret(parsed.secretBytes, storedHash);
}
