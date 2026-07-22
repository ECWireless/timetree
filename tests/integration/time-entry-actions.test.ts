import { randomUUID } from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { AuthorizationError } from "../../src/lib/auth/policy";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const authSecret = "synthetic-time-entry-action-secret-only";
const allowedEmail = "time-entry-action-user@example.test";
const pool = new Pool({ connectionString });
const userIds = new Set<string>();
let requestHeaders = new Headers();
let getNodeEntries: typeof import("../../src/lib/server/time-entries").getNodeEntries;
let createTimeEntry: typeof import("../../src/app/actions/time-entries").createTimeEntry;
let deleteTimeEntry: typeof import("../../src/app/actions/time-entries").deleteTimeEntry;
let loadTimeEntriesPage: typeof import(
  "../../src/app/actions/time-entries"
).loadTimeEntriesPage;
let updateTimeEntry: typeof import("../../src/app/actions/time-entries").updateTimeEntry;

vi.mock("next/headers", () => ({ headers: async () => requestHeaders }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

async function seedAuthorizedSession() {
  const userId = `time-entry-action-user-${randomUUID()}`;
  const token = `time-entry-action-token-${randomUUID()}`;
  userIds.add(userId);
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Entry Action User', $2, true)`,
    [userId, allowedEmail],
  );
  await pool.query(
    `insert into "session" (id, user_id, token, expires_at)
     values ($1, $2, $3, now() + interval '1 hour')`,
    [`time-entry-action-session-${randomUUID()}`, userId, token],
  );
  const node = await pool.query<{ id: string }>(
    `insert into nodes (user_id, position, title, hourly_rate_cents)
     values ($1, 0, 'Synthetic action node', 12500)
     returning id`,
    [userId],
  );
  const signature = await makeSignature(token, authSecret);
  requestHeaders = new Headers({
    cookie: `better-auth.session_token=${token}.${signature}`,
  });
  return { userId, nodeId: node.rows[0].id };
}

describe("time-entry Server Actions", () => {
  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", authSecret);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-google-client-secret");
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);
    ({ createTimeEntry, deleteTimeEntry, loadTimeEntriesPage, updateTimeEntry } = await import(
      "../../src/app/actions/time-entries"
    ));
    ({ getNodeEntries } = await import("../../src/lib/server/time-entries"));
  });

  afterEach(async () => {
    requestHeaders = new Headers();
    if (userIds.size > 0) {
      await pool.query(`delete from time_entries where user_id = any($1::text[])`, [[...userIds]]);
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

  it("authorizes before returning validation details", async () => {
    await expect(
      createTimeEntry({ nodeId: "not-a-uuid", mode: "duration", workDate: "bad", duration: "" }),
    ).rejects.toEqual(new AuthorizationError("missing-session"));
    await expect(deleteTimeEntry({ id: "not-a-uuid" })).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
  });

  it("validates duration and exact-range input and snapshots the default rate", async () => {
    const { nodeId } = await seedAuthorizedSession();
    const invalidDuration = await createTimeEntry({
      nodeId,
      mode: "duration",
      workDate: "2026-02-29",
      duration: "1:30",
    });
    expect(invalidDuration).toMatchObject({
      ok: false,
      fieldErrors: { workDate: expect.any(Array), duration: expect.any(Array) },
    });

    const invalidRange = await createTimeEntry({
      nodeId,
      mode: "range",
      workDate: "2026-07-22",
      startedAt: "2026-07-23T00:30:00.000Z",
      endedAt: "2026-07-22T23:30:00.000Z",
    });
    expect(invalidRange).toMatchObject({
      ok: false,
      fieldErrors: { endedAt: ["End must be later than start."] },
    });

    const mismatchedWorkDate = await createTimeEntry({
      nodeId,
      mode: "range",
      workDate: "2026-07-21",
      startedAt: "2026-07-22T23:30:00-07:00",
      endedAt: "2026-07-23T00:30:00-07:00",
    });
    expect(mismatchedWorkDate).toMatchObject({
      ok: false,
      fieldErrors: { workDate: ["Work date must match the local start date."] },
    });

    const created = await createTimeEntry({
      nodeId,
      mode: "range",
      workDate: "2026-07-22",
      startedAt: "2026-07-22T23:30:00.000Z",
      endedAt: "2026-07-23T00:45:00.000Z",
      notes: "  Cross midnight  ",
    });
    expect(created).toMatchObject({
      ok: true,
      entry: {
        workDate: "2026-07-22",
        durationSeconds: 4_500,
        hourlyRateCents: 12_500,
        notes: "Cross midnight",
      },
    });
  });

  it("preserves rate through action correction unless explicitly changed", async () => {
    const { nodeId } = await seedAuthorizedSession();
    const created = await createTimeEntry({
      nodeId,
      mode: "duration",
      workDate: "2026-07-22",
      duration: "1h",
    });
    if (!created.ok) {
      throw new Error("Expected entry creation to succeed.");
    }

    const updated = await updateTimeEntry({
      id: created.entry.id,
      nodeId,
      mode: "duration",
      workDate: "2026-07-23",
      duration: "90m",
      notes: "Corrected",
    });
    expect(updated).toMatchObject({
      ok: true,
      entry: { durationSeconds: 5_400, hourlyRateCents: 12_500 },
    });

    const unpriced = await updateTimeEntry({
      id: created.entry.id,
      nodeId,
      mode: "duration",
      workDate: "2026-07-23",
      duration: "90m",
      hourlyRateCents: null,
    });
    expect(unpriced).toMatchObject({ ok: true, entry: { hourlyRateCents: null } });
  });

  it("server-verifies exact-range preservation and replacement work dates", async () => {
    const { nodeId } = await seedAuthorizedSession();
    const created = await createTimeEntry({
      nodeId,
      mode: "range",
      workDate: "2026-07-22",
      startedAt: "2026-07-22T23:30:00-07:00",
      endedAt: "2026-07-23T00:30:00-07:00",
    });
    if (!created.ok) {
      throw new Error("Expected exact-range creation to succeed.");
    }

    const preserved = await updateTimeEntry({
      id: created.entry.id,
      nodeId,
      mode: "range",
      start: { kind: "preserve" },
      end: { kind: "preserve" },
      notes: "Notes-only correction",
    });
    expect(preserved).toMatchObject({
      ok: true,
      entry: {
        workDate: "2026-07-22",
        startedAt: created.entry.startedAt,
        endedAt: created.entry.endedAt,
        durationSeconds: created.entry.durationSeconds,
      },
    });

    const mismatchedReplacement = await updateTimeEntry({
      id: created.entry.id,
      nodeId,
      mode: "range",
      start: {
        kind: "replace",
        value: "2026-07-24T09:00:00-07:00",
        workDate: "2026-07-23",
      },
      end: { kind: "preserve" },
    });
    expect(mismatchedReplacement).toMatchObject({
      ok: false,
      fieldErrors: { startedAt: ["Work date must match the local start date."] },
    });
  });

  it("validates cursors and deletes entries permanently", async () => {
    const { userId, nodeId } = await seedAuthorizedSession();
    expect(
      await loadTimeEntriesPage(nodeId, { createdAt: "not-a-date", id: "not-a-uuid" }),
    ).toMatchObject({ ok: false, fieldErrors: { cursor: expect.any(Array) } });

    await pool.query(
      `insert into time_entries
         (user_id, node_id, work_date, duration_seconds, created_at)
       select $1, $2, date '2026-07-22', 60,
         timestamptz '2026-07-22T00:00:00.000000Z' + ordinal * interval '1 microsecond'
       from generate_series(1, 51) as ordinal`,
      [userId, nodeId],
    );
    const firstPage = await getNodeEntries(nodeId);
    expect(firstPage.nextCursor).not.toBeNull();
    await expect(loadTimeEntriesPage(nodeId, firstPage.nextCursor!)).resolves.toMatchObject({
      ok: true,
      page: { entries: [expect.objectContaining({ durationSeconds: 60 })], nextCursor: null },
    });

    const created = await createTimeEntry({
      nodeId,
      mode: "duration",
      workDate: "2026-07-22",
      duration: "1h",
    });
    if (!created.ok) {
      throw new Error("Expected entry creation to succeed.");
    }
    expect(await deleteTimeEntry({ id: created.entry.id })).toEqual({
      ok: true,
      entryId: created.entry.id,
    });
  });
});
