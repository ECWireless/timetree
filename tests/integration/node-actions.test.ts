import { randomUUID } from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { AuthorizationError } from "../../src/lib/auth/policy";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const authSecret = "synthetic-node-action-secret-only";
const allowedEmail = "node-action-user@example.test";
const pool = new Pool({ connectionString });
const userIds = new Set<string>();
let requestHeaders = new Headers();
let createNode: typeof import("../../src/app/actions/nodes").createNode;
let updateNode: typeof import("../../src/app/actions/nodes").updateNode;

vi.mock("next/headers", () => ({
  headers: async () => requestHeaders,
}));

vi.mock("next/cache", () => ({
  revalidatePath: vi.fn(),
}));

async function seedAuthorizedSession() {
  const userId = `node-action-user-${randomUUID()}`;
  const token = `node-action-token-${randomUUID()}`;
  userIds.add(userId);

  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Node Action User', $2, true)`,
    [userId, allowedEmail],
  );
  await pool.query(
    `insert into "session" (id, user_id, token, expires_at)
     values ($1, $2, $3, now() + interval '1 hour')`,
    [`node-action-session-${randomUUID()}`, userId, token],
  );

  const signature = await makeSignature(token, authSecret);
  requestHeaders = new Headers({
    cookie: `better-auth.session_token=${token}.${signature}`,
  });
  return userId;
}

describe("node Server Actions", () => {
  beforeAll(async () => {
    process.env.BETTER_AUTH_SECRET = authSecret;
    process.env.BETTER_AUTH_URL = "http://localhost:3000";
    process.env.GOOGLE_CLIENT_ID = "synthetic-google-client-id";
    process.env.GOOGLE_CLIENT_SECRET = "synthetic-google-client-secret";
    process.env.ALLOWED_EMAIL = allowedEmail;

    ({ createNode, updateNode } = await import("../../src/app/actions/nodes"));
  });

  afterEach(async () => {
    requestHeaders = new Headers();
    if (userIds.size > 0) {
      await pool.query(`delete from "user" where id = any($1::text[])`, [[...userIds]]);
      userIds.clear();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("authorizes before returning validation details or mutating data", async () => {
    const before = await pool.query<{ count: string }>("select count(*) from nodes");
    await expect(createNode({ title: "" })).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );

    const after = await pool.query<{ count: string }>("select count(*) from nodes");
    expect(after.rows[0].count).toBe(before.rows[0].count);
  });

  it("maps validation failures and preserves the last valid stored rate", async () => {
    const userId = await seedAuthorizedSession();
    const created = await createNode({ title: "Action-created root" });
    expect(created.ok).toBe(true);
    if (!created.ok) {
      throw new Error("Expected node creation to succeed.");
    }

    const maximum = await updateNode({
      id: created.nodeId,
      hourlyRateCents: 2_147_483_647,
    });
    expect(maximum.ok).toBe(true);

    const blankDescription = await updateNode({
      id: created.nodeId,
      description: "   ",
    });
    expect(blankDescription.ok).toBe(true);

    const overflow = await updateNode({
      id: created.nodeId,
      hourlyRateCents: 2_147_483_648,
    });
    expect(overflow).toMatchObject({
      ok: false,
      fieldErrors: { hourlyRateCents: ["The hourly rate is too large."] },
    });

    const stored = await pool.query<{ description: string | null; hourly_rate_cents: number }>(
      `select description, hourly_rate_cents from nodes where user_id = $1 and id = $2`,
      [userId, created.nodeId],
    );
    expect(stored.rows[0].description).toBeNull();
    expect(stored.rows[0].hourly_rate_cents).toBe(2_147_483_647);
  });
});
