import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const pool = new Pool({ connectionString });
const userIds = new Set<string>();

let AgentApiKeyMutationError: typeof import(
  "../../src/lib/server/agent-api-key-service"
).AgentApiKeyMutationError;
let createAgentApiKeyForUser: typeof import(
  "../../src/lib/server/agent-api-key-service"
).createAgentApiKeyForUser;
let getAgentApiKeyMetadataForUser: typeof import(
  "../../src/lib/server/agent-api-key-service"
).getAgentApiKeyMetadataForUser;
let revokeAgentApiKeyForUser: typeof import(
  "../../src/lib/server/agent-api-key-service"
).revokeAgentApiKeyForUser;
let rotateAgentApiKeyForUser: typeof import(
  "../../src/lib/server/agent-api-key-service"
).rotateAgentApiKeyForUser;
let generateAgentApiKey: typeof import(
  "../../src/lib/server/agent-api-key-token"
).generateAgentApiKey;
let parseAgentApiKey: typeof import(
  "../../src/lib/server/agent-api-key-token"
).parseAgentApiKey;
let verifyAgentApiKeySecret: typeof import(
  "../../src/lib/server/agent-api-key-token"
).verifyAgentApiKeySecret;
let deleteNodeForUser: typeof import(
  "../../src/lib/server/node-service"
).deleteNodeForUser;

async function insertUser() {
  const userId = `agent-key-user-${randomUUID()}`;
  userIds.add(userId);
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Agent Key User', $2, true)`,
    [userId, `${userId}@example.test`],
  );
  return userId;
}

async function insertNode(userId: string, position = 0) {
  const result = await pool.query<{ id: string }>(
    `insert into nodes (user_id, position, title)
     values ($1, $2, 'Synthetic agent scope') returning id`,
    [userId, position],
  );
  return result.rows[0].id;
}

async function readStoredCredential(credentialId: string) {
  const result = await pool.query<{
    id: string;
    user_id: string;
    root_node_id: string;
    secret_hash: string;
    created_at: Date;
  }>(
    `select id, user_id, root_node_id, secret_hash, created_at
     from agent_api_keys where id = $1`,
    [credentialId],
  );
  return result.rows[0];
}

describe("agent API key foundation", () => {
  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", "synthetic-agent-key-service-secret");
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-google-client-secret");
    vi.stubEnv("ALLOWED_EMAIL", "agent-key-user@example.test");

    ({
      AgentApiKeyMutationError,
      createAgentApiKeyForUser,
      getAgentApiKeyMetadataForUser,
      revokeAgentApiKeyForUser,
      rotateAgentApiKeyForUser,
    } = await import("../../src/lib/server/agent-api-key-service"));
    ({ generateAgentApiKey, parseAgentApiKey, verifyAgentApiKeySecret } = await import(
      "../../src/lib/server/agent-api-key-token"
    ));
    ({ deleteNodeForUser } = await import("../../src/lib/server/node-service"));
  });

  afterEach(async () => {
    if (userIds.size > 0) {
      await pool.query(`delete from time_entries where user_id = any($1::text[])`, [[...userIds]]);
      await pool.query(`delete from active_timers where user_id = any($1::text[])`, [[...userIds]]);
      await pool.query(`delete from "user" where id = any($1::text[])`, [[...userIds]]);
      userIds.clear();
    }
  });

  afterAll(async () => {
    try {
      await pool.end();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("strictly parses generated keys and verifies fixed-length secret hashes", () => {
    const generated = generateAgentApiKey();
    const parsed = parseAgentApiKey(generated.apiKey);

    expect(generated.apiKey).toMatch(
      /^ttk_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(generated.secretHash).toMatch(/^[0-9a-f]{64}$/);
    expect(parsed?.credentialId).toBe(generated.credentialId);
    expect(parsed?.secretBytes).toHaveLength(32);
    expect(
      parsed &&
        verifyAgentApiKeySecret(parsed.secretBytes, generated.secretHash),
    ).toBe(true);

    const other = generateAgentApiKey();
    const otherParsed = parseAgentApiKey(other.apiKey);
    expect(
      otherParsed &&
        verifyAgentApiKeySecret(otherParsed.secretBytes, generated.secretHash),
    ).toBe(false);
    expect(verifyAgentApiKeySecret(Buffer.alloc(32), "A".repeat(64))).toBe(false);

    for (const malformed of [
      "",
      generated.apiKey.toUpperCase(),
      `Bearer ${generated.apiKey}`,
      generated.apiKey.replace("ttk_v1.", "ttk_v2."),
      `${generated.apiKey}.extra`,
      generated.apiKey.slice(0, -1),
      generated.apiKey.replace(/[A-Za-z0-9_-]$/, "="),
    ]) {
      expect(parseAgentApiKey(malformed)).toBeNull();
    }
  });

  it("stores only a hash and returns secret material only at creation", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId);

    const created = await createAgentApiKeyForUser(userId, nodeId);
    const parsed = parseAgentApiKey(created.apiKey);
    const stored = await readStoredCredential(created.credential.id);

    expect(parsed?.credentialId).toBe(stored.id);
    expect(stored).toMatchObject({
      user_id: userId,
      root_node_id: nodeId,
      secret_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
    });
    expect(created.credential).toEqual({
      id: stored.id,
      createdAt: stored.created_at.toISOString(),
    });
    expect(
      parsed && verifyAgentApiKeySecret(parsed.secretBytes, stored.secret_hash),
    ).toBe(true);
    expect(JSON.stringify(stored)).not.toContain(created.apiKey);
    await expect(getAgentApiKeyMetadataForUser(userId, nodeId)).resolves.toEqual(
      created.credential,
    );
  });

  it("owner-scopes metadata and allows only one concurrent creation", async () => {
    const userId = await insertUser();
    const otherUserId = await insertUser();
    const nodeId = await insertNode(userId);

    await expect(
      getAgentApiKeyMetadataForUser(otherUserId, nodeId),
    ).rejects.toEqual(new AgentApiKeyMutationError("node-not-found"));
    await expect(
      createAgentApiKeyForUser(otherUserId, nodeId),
    ).rejects.toEqual(new AgentApiKeyMutationError("node-not-found"));

    const results = await Promise.allSettled([
      createAgentApiKeyForUser(userId, nodeId),
      createAgentApiKeyForUser(userId, nodeId),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toEqual([
      {
        status: "rejected",
        reason: new AgentApiKeyMutationError("credential-already-exists"),
      },
    ]);
  });

  it("rotates once against an expected credential and rejects stale actions", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId);
    const original = await createAgentApiKeyForUser(userId, nodeId);

    const rotations = await Promise.allSettled([
      rotateAgentApiKeyForUser(userId, nodeId, original.credential.id),
      rotateAgentApiKeyForUser(userId, nodeId, original.credential.id),
    ]);
    const succeeded = rotations.find(
      (result): result is PromiseFulfilledResult<Awaited<ReturnType<typeof rotateAgentApiKeyForUser>>> =>
        result.status === "fulfilled",
    );
    expect(succeeded).toBeDefined();
    expect(rotations.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(rotations.filter(({ status }) => status === "rejected")).toEqual([
      {
        status: "rejected",
        reason: new AgentApiKeyMutationError("credential-changed"),
      },
    ]);
    if (!succeeded) {
      throw new Error("Expected one rotation to succeed.");
    }

    const current = await readStoredCredential(succeeded.value.credential.id);
    const originalParsed = parseAgentApiKey(original.apiKey);
    const rotatedParsed = parseAgentApiKey(succeeded.value.apiKey);
    expect(originalParsed && verifyAgentApiKeySecret(originalParsed.secretBytes, current.secret_hash)).toBe(
      false,
    );
    expect(rotatedParsed && verifyAgentApiKeySecret(rotatedParsed.secretBytes, current.secret_hash)).toBe(
      true,
    );

    await expect(
      revokeAgentApiKeyForUser(userId, nodeId, original.credential.id),
    ).rejects.toEqual(new AgentApiKeyMutationError("credential-changed"));
    await expect(
      revokeAgentApiKeyForUser(userId, nodeId, succeeded.value.credential.id),
    ).resolves.toEqual({ credentialId: succeeded.value.credential.id });
    await expect(getAgentApiKeyMetadataForUser(userId, nodeId)).resolves.toBeNull();
  });

  it("cascades credentials with successful node deletion and preserves them on rollback", async () => {
    const userId = await insertUser();
    const deletableNodeId = await insertNode(userId);
    const retainedNodeId = await insertNode(userId, 1);
    const deletable = await createAgentApiKeyForUser(userId, deletableNodeId);
    const retained = await createAgentApiKeyForUser(userId, retainedNodeId);
    await pool.query(
      `insert into time_entries (user_id, node_id, work_date, duration_seconds)
       values ($1, $2, '2026-07-23', 60)`,
      [userId, retainedNodeId],
    );

    await expect(deleteNodeForUser(userId, deletableNodeId)).resolves.toEqual({
      nodeId: deletableNodeId,
    });
    await expect(readStoredCredential(deletable.credential.id)).resolves.toBeUndefined();
    await expect(deleteNodeForUser(userId, retainedNodeId)).rejects.toMatchObject({
      reason: "history-exists",
    });
    await expect(readStoredCredential(retained.credential.id)).resolves.toBeDefined();
  });

  it("serializes credential creation against scope-root deletion", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId);

    const results = await Promise.allSettled([
      createAgentApiKeyForUser(userId, nodeId),
      deleteNodeForUser(userId, nodeId),
    ]);
    const creation = results[0];
    const deletion = results[1];

    expect(deletion).toEqual({
      status: "fulfilled",
      value: { nodeId },
    });
    if (creation.status === "rejected") {
      expect(creation.reason).toEqual(
        new AgentApiKeyMutationError("node-not-found"),
      );
    }

    const storedNodes = await pool.query<{ count: string }>(
      `select count(*) from nodes where user_id = $1 and id = $2`,
      [userId, nodeId],
    );
    const storedCredentials = await pool.query<{ count: string }>(
      `select count(*) from agent_api_keys
       where user_id = $1 and root_node_id = $2`,
      [userId, nodeId],
    );
    expect(storedNodes.rows[0].count).toBe("0");
    expect(storedCredentials.rows[0].count).toBe("0");
  });
});
