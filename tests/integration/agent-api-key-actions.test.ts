import { randomUUID } from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { AuthorizationError } from "../../src/lib/auth/policy";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const authSecret = "synthetic-agent-key-action-secret";
const allowedEmail = "agent-key-action-user@example.test";
const pool = new Pool({ connectionString });
const userIds = new Set<string>();
let requestHeaders = new Headers();

let createAgentApiKey: typeof import(
  "../../src/app/actions/agent-api-keys"
).createAgentApiKey;
let rotateAgentApiKey: typeof import(
  "../../src/app/actions/agent-api-keys"
).rotateAgentApiKey;
let revokeAgentApiKey: typeof import(
  "../../src/app/actions/agent-api-keys"
).revokeAgentApiKey;
let getAgentApiKeyMetadata: typeof import(
  "../../src/lib/server/agent-api-keys"
).getAgentApiKeyMetadata;
let listAgentApiKeyMetadata: typeof import(
  "../../src/lib/server/agent-api-keys"
).listAgentApiKeyMetadata;

vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

async function seedAuthorizedSession() {
  const userId = `agent-key-action-user-${randomUUID()}`;
  const token = `agent-key-action-token-${randomUUID()}`;
  userIds.add(userId);

  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Agent Key Action User', $2, true)`,
    [userId, allowedEmail],
  );
  await pool.query(
    `insert into "session" (id, user_id, token, expires_at)
     values ($1, $2, $3, now() + interval '1 hour')`,
    [`agent-key-action-session-${randomUUID()}`, userId, token],
  );
  const node = await pool.query<{ id: string }>(
    `insert into nodes (user_id, position, title)
     values ($1, 0, 'Synthetic agent action node') returning id`,
    [userId],
  );

  const signature = await makeSignature(token, authSecret);
  requestHeaders = new Headers({
    cookie: `better-auth.session_token=${token}.${signature}`,
  });
  return { userId, nodeId: node.rows[0].id };
}

describe("agent API key owner boundary", () => {
  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", authSecret);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-google-client-secret");
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);

    ({ createAgentApiKey, revokeAgentApiKey, rotateAgentApiKey } = await import(
      "../../src/app/actions/agent-api-keys"
    ));
    ({ getAgentApiKeyMetadata, listAgentApiKeyMetadata } = await import(
      "../../src/lib/server/agent-api-keys"
    ));
  });

  afterEach(async () => {
    requestHeaders = new Headers();
    process.env.ALLOWED_EMAIL = allowedEmail;
    if (userIds.size > 0) {
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

  it("authorizes before validating key-management input", async () => {
    await expect(createAgentApiKey({ nodeId: "invalid" })).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
    await expect(
      rotateAgentApiKey({ nodeId: "invalid", credentialId: "invalid" }),
    ).rejects.toEqual(new AuthorizationError("missing-session"));
    await expect(
      revokeAgentApiKey({ nodeId: "invalid", credentialId: "invalid" }),
    ).rejects.toEqual(new AuthorizationError("missing-session"));
    await expect(getAgentApiKeyMetadata("invalid")).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
    await expect(listAgentApiKeyMetadata("invalid")).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
  });

  it("returns plaintext once per creation or rotation and metadata thereafter", async () => {
    const { nodeId } = await seedAuthorizedSession();

    const created = await createAgentApiKey({
      nodeId,
      label: "Application",
      accessLevel: "read_write",
    });
    expect(created).toMatchObject({
      ok: true,
      apiKey: expect.stringMatching(/^ttk_v2\./),
      credential: {
        id: expect.any(String),
        label: "Application",
        accessLevel: "read_write",
        createdAt: expect.any(String),
      },
    });
    if (!created.ok) {
      throw new Error("Expected key creation to succeed.");
    }
    expect(await getAgentApiKeyMetadata(nodeId)).toEqual(created.credential);
    const client = await createAgentApiKey({
      nodeId,
      label: "Client",
      accessLevel: "read_only",
    });
    expect(client).toMatchObject({
      ok: true,
      credential: { label: "Client", accessLevel: "read_only" },
    });
    if (!client.ok) {
      throw new Error("Expected client key creation to succeed.");
    }
    expect(await listAgentApiKeyMetadata(nodeId)).toEqual(
      expect.arrayContaining([created.credential, client.credential]),
    );

    const rotated = await rotateAgentApiKey({
      nodeId,
      credentialId: created.credential.id,
      label: "Application reporting",
      accessLevel: "read_only",
    });
    expect(rotated).toMatchObject({
      ok: true,
      apiKey: expect.stringMatching(/^ttk_v2\./),
      credential: {
        id: expect.any(String),
        label: "Application reporting",
        accessLevel: "read_only",
      },
    });
    if (!rotated.ok) {
      throw new Error("Expected key rotation to succeed.");
    }
    expect(rotated.apiKey).not.toBe(created.apiKey);
    expect(await listAgentApiKeyMetadata(nodeId)).toEqual(
      expect.arrayContaining([client.credential, rotated.credential]),
    );
    expect(
      await revokeAgentApiKey({
        nodeId,
        credentialId: created.credential.id,
      }),
    ).toEqual({
      ok: false,
      message: "Agent access is no longer available.",
    });

    expect(
      await revokeAgentApiKey({
        nodeId,
        credentialId: rotated.credential.id,
      }),
    ).toEqual({
      ok: true,
      credentialId: rotated.credential.id,
    });
    expect(await listAgentApiKeyMetadata(nodeId)).toEqual([client.credential]);
    await expect(
      revokeAgentApiKey({
        nodeId,
        credentialId: client.credential.id,
      }),
    ).resolves.toEqual({
      ok: true,
      credentialId: client.credential.id,
    });
    expect(await listAgentApiKeyMetadata(nodeId)).toEqual([]);
  });

  it("rejects malformed metadata identifiers after owner authorization", async () => {
    await seedAuthorizedSession();

    await expect(getAgentApiKeyMetadata("invalid")).rejects.toMatchObject({
      reason: "node-not-found",
    });
    await expect(listAgentApiKeyMetadata("invalid")).rejects.toMatchObject({
      reason: "node-not-found",
    });
  });

  it("re-evaluates the owner allowlist for every management action", async () => {
    const { nodeId } = await seedAuthorizedSession();
    await expect(createAgentApiKey({ nodeId })).resolves.toMatchObject({ ok: true });

    process.env.ALLOWED_EMAIL = "replacement-user@example.test";
    await expect(getAgentApiKeyMetadata(nodeId)).rejects.toEqual(
      new AuthorizationError("disallowed-email"),
    );
    await expect(listAgentApiKeyMetadata(nodeId)).rejects.toEqual(
      new AuthorizationError("disallowed-email"),
    );
    await expect(createAgentApiKey({ nodeId })).rejects.toEqual(
      new AuthorizationError("disallowed-email"),
    );
  });
});
