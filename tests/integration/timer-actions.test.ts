import { randomUUID } from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { AuthorizationError } from "../../src/lib/auth/policy";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const authSecret = "synthetic-timer-action-secret-only";
const allowedEmail = "timer-action-user@example.test";
const pool = new Pool({ connectionString });
const userIds = new Set<string>();
let requestHeaders = new Headers();
let startTimer: typeof import("../../src/app/actions/timers").startTimer;
let stopTimer: typeof import("../../src/app/actions/timers").stopTimer;

vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function seedAuthorizedSession() {
  const userId = `timer-action-user-${randomUUID()}`;
  const token = `timer-action-token-${randomUUID()}`;
  userIds.add(userId);
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Timer Action User', $2, true)`,
    [userId, allowedEmail],
  );
  await pool.query(
    `insert into "session" (id, user_id, token, expires_at)
     values ($1, $2, $3, now() + interval '1 hour')`,
    [`timer-action-session-${randomUUID()}`, userId, token],
  );
  const signature = await makeSignature(token, authSecret);
  requestHeaders = new Headers({
    cookie: `better-auth.session_token=${token}.${signature}`,
  });
  return userId;
}

async function insertNode(userId: string, completed = false) {
  const result = await pool.query<{ id: string }>(
    `insert into nodes (user_id, position, title, completed_at)
     values ($1, 0, 'Synthetic timer node', $2) returning id`,
    [userId, completed ? new Date("2026-07-01T00:00:00.000Z") : null],
  );
  return result.rows[0].id;
}

describe("timer Server Actions", () => {
  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", authSecret);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-google-client-secret");
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);
    ({ startTimer, stopTimer } = await import("../../src/app/actions/timers"));
  });

  afterEach(async () => {
    requestHeaders = new Headers();
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

  it("authorizes before validating timer inputs", async () => {
    await expect(startTimer({ nodeId: "invalid", workDate: "invalid" })).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
    await expect(stopTimer({ timerId: "invalid" })).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
  });

  it("validates local work dates and exposes start and stop results", async () => {
    const userId = await seedAuthorizedSession();
    const nodeId = await insertNode(userId);
    expect(await startTimer({ nodeId, workDate: "2026-02-30" })).toMatchObject({
      ok: false,
      fieldErrors: { workDate: ["Choose a valid work date."] },
    });
    const started = await startTimer({ nodeId, workDate: "2026-07-22" });
    expect(started).toMatchObject({ ok: true, timer: { nodeId, workDate: "2026-07-22" } });
    if (!started.ok) {
      throw new Error("Expected timer start to succeed.");
    }
    expect(await startTimer({ nodeId, workDate: "2026-07-22" })).toEqual({
      ok: false,
      message: "A timer is already running on that node.",
    });
    expect(await stopTimer({ timerId: started.timer.id })).toMatchObject({
      ok: true,
      timerId: started.timer.id,
      entryId: expect.any(String),
    });
    expect(await stopTimer({ timerId: started.timer.id })).toEqual({
      ok: false,
      message: "That timer is no longer running.",
    });
  });

  it("returns owner-safe missing and completed-node failures", async () => {
    const ownerId = await seedAuthorizedSession();
    const completedId = await insertNode(ownerId, true);
    expect(await startTimer({ nodeId: completedId, workDate: "2026-07-22" })).toEqual({
      ok: false,
      message: "Reopen this node before starting a timer.",
    });
    expect(await stopTimer({ timerId: randomUUID() })).toEqual({
      ok: false,
      message: "That timer is no longer running.",
    });
  });
});
