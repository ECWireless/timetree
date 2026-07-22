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
let completeNode: typeof import("../../src/app/actions/nodes").completeNode;
let createNode: typeof import("../../src/app/actions/nodes").createNode;
let deleteNode: typeof import("../../src/app/actions/nodes").deleteNode;
let moveNode: typeof import("../../src/app/actions/nodes").moveNode;
let reopenNode: typeof import("../../src/app/actions/nodes").reopenNode;
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
    vi.stubEnv("BETTER_AUTH_SECRET", authSecret);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-google-client-secret");
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);

    ({ completeNode, createNode, deleteNode, moveNode, reopenNode, updateNode } = await import(
      "../../src/app/actions/nodes"
    ));
  });

  afterEach(async () => {
    requestHeaders = new Headers();
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

  it("authorizes before returning validation details or mutating data", async () => {
    const before = await pool.query<{ count: string }>("select count(*) from nodes");
    await expect(createNode({ title: "" })).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
    await expect(
      moveNode({ id: "not-a-uuid", parentId: null }),
    ).rejects.toEqual(new AuthorizationError("missing-session"));
    await expect(completeNode({ id: "not-a-uuid" })).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
    await expect(reopenNode({ id: "not-a-uuid" })).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
    await expect(deleteNode({ id: "not-a-uuid" })).rejects.toEqual(
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

  it("authorizes and exposes the organization and lifecycle mutations", async () => {
    const userId = await seedAuthorizedSession();
    const root = await createNode({ title: "Root" });
    const destination = await createNode({ title: "Destination" });
    expect(root.ok && destination.ok).toBe(true);
    if (!root.ok || !destination.ok) {
      throw new Error("Expected node creation to succeed.");
    }

    expect(
      await moveNode({ id: root.nodeId, parentId: destination.nodeId, position: 0 }),
    ).toEqual({ ok: true, nodeId: root.nodeId });
    expect(await completeNode({ id: destination.nodeId })).toEqual({
      ok: true,
      nodeId: destination.nodeId,
    });
    expect(await reopenNode({ id: root.nodeId })).toEqual({
      ok: true,
      nodeId: root.nodeId,
    });
    expect(await deleteNode({ id: root.nodeId })).toEqual({
      ok: true,
      nodeId: root.nodeId,
    });

    const remaining = await pool.query<{ id: string; completed_at: Date | null }>(
      `select id, completed_at from nodes where user_id = $1`,
      [userId],
    );
    expect(remaining.rows).toEqual([{ id: destination.nodeId, completed_at: null }]);
  });

  it("returns stable validation and lifecycle failures", async () => {
    await seedAuthorizedSession();
    expect(await completeNode({ id: "not-a-uuid" })).toMatchObject({
      ok: false,
      fieldErrors: { id: expect.any(Array) },
    });

    const destination = await createNode({ title: "Completed destination" });
    const source = await createNode({ title: "Source" });
    if (!destination.ok || !source.ok) {
      throw new Error("Expected node creation to succeed.");
    }
    await completeNode({ id: destination.nodeId });

    expect(await moveNode({ id: source.nodeId, parentId: destination.nodeId })).toEqual({
      ok: false,
      message: "Reopen the destination before adding or moving a node there.",
    });
  });
});
