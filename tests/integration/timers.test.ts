import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const pool = new Pool({ connectionString });
const userIds = new Set<string>();
let startTimerForUser: typeof import("../../src/lib/server/timer-service").startTimerForUser;
let stopTimerForUser: typeof import("../../src/lib/server/timer-service").stopTimerForUser;
let TimerMutationError: typeof import("../../src/lib/server/timer-service").TimerMutationError;
let completeNodeForUser: typeof import(
  "../../src/lib/server/node-service"
).completeNodeForUser;
let getDashboardDataForUser: typeof import(
  "../../src/lib/server/node-service"
).getDashboardDataForUser;

async function insertUser() {
  const userId = `timer-user-${randomUUID()}`;
  userIds.add(userId);
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Timer User', $2, true)`,
    [userId, `${userId}@example.test`],
  );
  return userId;
}

async function insertNode(
  userId: string,
  title: string,
  options: {
    parentId?: string;
    position?: number;
    hourlyRateCents?: number | null;
    completed?: boolean;
  } = {},
) {
  const result = await pool.query<{ id: string }>(
    `insert into nodes
       (user_id, parent_id, position, title, hourly_rate_cents, completed_at)
     values ($1, $2, $3, $4, $5, $6)
     returning id`,
    [
      userId,
      options.parentId ?? null,
      options.position ?? 0,
      title,
      options.hourlyRateCents ?? null,
      options.completed ? new Date("2026-07-01T00:00:00.000Z") : null,
    ],
  );
  return result.rows[0].id;
}

describe("persistent timer service", () => {
  beforeAll(async () => {
    ({ startTimerForUser, stopTimerForUser, TimerMutationError } = await import(
      "../../src/lib/server/timer-service"
    ));
    ({ completeNodeForUser, getDashboardDataForUser } = await import(
      "../../src/lib/server/node-service"
    ));
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
    await pool.end();
  });

  it("allows timers on different nodes and rejects duplicate concurrent starts", async () => {
    const userId = await insertUser();
    const firstNodeId = await insertNode(userId, "First");
    const secondNodeId = await insertNode(userId, "Second", { position: 1 });
    const startedAt = new Date("2026-07-22T10:00:00.000Z");

    const [first, second] = await Promise.all([
      startTimerForUser(userId, firstNodeId, "2026-07-22", startedAt),
      startTimerForUser(userId, secondNodeId, "2026-07-22", startedAt),
    ]);
    expect([first.nodeId, second.nodeId].sort()).toEqual([firstNodeId, secondNodeId].sort());

    const racedNodeId = await insertNode(userId, "Raced start", { position: 2 });
    const duplicateResults = await Promise.allSettled([
      startTimerForUser(userId, racedNodeId, "2026-07-22", startedAt),
      startTimerForUser(userId, racedNodeId, "2026-07-22", startedAt),
    ]);
    expect(duplicateResults.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(duplicateResults.filter(({ status }) => status === "rejected")).toEqual([
      { status: "rejected", reason: new TimerMutationError("already-running") },
    ]);
  });

  it("snapshots inherited, explicit-zero, and unpriced rates at start", async () => {
    const userId = await insertUser();
    const rootId = await insertNode(userId, "Root", { hourlyRateCents: 12_500 });
    const inheritedId = await insertNode(userId, "Inherited", { parentId: rootId });
    const zeroId = await insertNode(userId, "Zero", {
      parentId: rootId,
      position: 1,
      hourlyRateCents: 0,
    });
    const unpricedId = await insertNode(userId, "Unpriced", { position: 1 });

    await expect(startTimerForUser(userId, inheritedId, "2026-07-22")).resolves.toMatchObject({
      hourlyRateCents: 12_500,
    });
    await expect(startTimerForUser(userId, zeroId, "2026-07-22")).resolves.toMatchObject({
      hourlyRateCents: 0,
    });
    await expect(startTimerForUser(userId, unpricedId, "2026-07-22")).resolves.toMatchObject({
      hourlyRateCents: null,
    });
    await pool.query(`update nodes set hourly_rate_cents = 25000 where id = $1`, [rootId]);

    const dashboard = await getDashboardDataForUser(userId);
    expect(dashboard.activeTimers.find(({ nodeId }) => nodeId === inheritedId)).toMatchObject({
      hourlyRateCents: 12_500,
      workDate: "2026-07-22",
    });
  });

  it("atomically stops into one exact historical entry using captured values", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId, "Timed", { hourlyRateCents: 12_500 });
    const startedAt = new Date("2026-07-31T23:59:30.000Z");
    const timer = await startTimerForUser(userId, nodeId, "2026-07-31", startedAt);
    await pool.query(`update nodes set hourly_rate_cents = 25000 where id = $1`, [nodeId]);

    const stopped = await stopTimerForUser(
      userId,
      timer.id,
      new Date("2026-08-01T00:01:00.999Z"),
    );
    const stored = await pool.query(
      `select node_id, work_date::text, started_at, ended_at, duration_seconds,
              hourly_rate_cents, notes
       from time_entries where id = $1`,
      [stopped.entry.id],
    );
    expect(stored.rows[0]).toMatchObject({
      node_id: nodeId,
      work_date: "2026-07-31",
      duration_seconds: 90,
      hourly_rate_cents: 12_500,
      notes: null,
    });
    expect(stored.rows[0].started_at.toISOString()).toBe(startedAt.toISOString());
    expect(stored.rows[0].ended_at.toISOString()).toBe("2026-08-01T00:01:00.999Z");
    await expect(stopTimerForUser(userId, timer.id)).rejects.toEqual(
      new TimerMutationError("timer-not-found"),
    );
  });

  it("keeps a dashboard-style repeatable-read snapshot coherent across a concurrent stop", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId, "Snapshot");
    const timer = await startTimerForUser(
      userId,
      nodeId,
      "2026-07-22",
      new Date("2026-07-22T10:00:00.000Z"),
    );
    let signalHistoricalRead!: () => void;
    const historicalRead = new Promise<void>((resolve) => {
      signalHistoricalRead = resolve;
    });
    let releaseDashboard!: () => void;
    const dashboardRelease = new Promise<void>((resolve) => {
      releaseDashboard = resolve;
    });
    const dashboardPromise = getDashboardDataForUser(
      userId,
      { mode: "all" },
      async () => {
        signalHistoricalRead();
        await dashboardRelease;
      },
    );
    await historicalRead;
    await stopTimerForUser(userId, timer.id, new Date("2026-07-22T10:01:00.000Z"));
    releaseDashboard();

    const sameSnapshot = await dashboardPromise;
    expect(sameSnapshot.activeTimers.map(({ id }) => id)).toEqual([timer.id]);
    expect(sameSnapshot.orderedNodes.find(({ id }) => id === nodeId)?.directDurationSeconds).toBe(0);

    const refreshed = await getDashboardDataForUser(userId);
    expect(refreshed.activeTimers).toEqual([]);
    expect(refreshed.orderedNodes.find(({ id }) => id === nodeId)?.directDurationSeconds).toBe(60);
  });

  it("produces exactly one entry when the same timer is stopped concurrently", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId, "Raced");
    const timer = await startTimerForUser(
      userId,
      nodeId,
      "2026-07-22",
      new Date("2026-07-22T10:00:00.000Z"),
    );
    const results = await Promise.allSettled([
      stopTimerForUser(userId, timer.id, new Date("2026-07-22T10:01:00.000Z")),
      stopTimerForUser(userId, timer.id, new Date("2026-07-22T10:01:01.000Z")),
    ]);
    expect(results.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
    expect(results.filter(({ status }) => status === "rejected")).toMatchObject([
      { reason: new TimerMutationError("timer-not-found") },
    ]);
    const entries = await pool.query<{ count: string }>(
      `select count(*) from time_entries where user_id = $1 and node_id = $2`,
      [userId, nodeId],
    );
    expect(entries.rows[0].count).toBe("1");
  });

  it("keeps the active timer when a stop cannot create its entry", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId, "Too long");
    const timer = await startTimerForUser(
      userId,
      nodeId,
      "2026-07-22",
      new Date("1900-01-01T00:00:00.000Z"),
    );

    await expect(
      stopTimerForUser(userId, timer.id, new Date("2026-07-22T00:00:00.000Z")),
    ).rejects.toEqual(new TimerMutationError("timer-too-long"));
    const stored = await pool.query<{ count: string }>(
      `select count(*) from active_timers where id = $1`,
      [timer.id],
    );
    expect(stored.rows[0].count).toBe("1");
  });

  it("owner-scopes timers and rejects completed or missing nodes", async () => {
    const ownerId = await insertUser();
    const otherId = await insertUser();
    const nodeId = await insertNode(ownerId, "Private");
    const completedId = await insertNode(ownerId, "Completed", { position: 1, completed: true });
    const timer = await startTimerForUser(ownerId, nodeId, "2026-07-22");

    await expect(startTimerForUser(otherId, nodeId, "2026-07-22")).rejects.toEqual(
      new TimerMutationError("node-not-found"),
    );
    await expect(startTimerForUser(ownerId, completedId, "2026-07-22")).rejects.toEqual(
      new TimerMutationError("node-completed"),
    );
    await expect(stopTimerForUser(otherId, timer.id)).rejects.toEqual(
      new TimerMutationError("timer-not-found"),
    );
    await startTimerForUser(otherId, await insertNode(otherId, "Other"), "2026-07-22");
    const ownerDashboard = await getDashboardDataForUser(ownerId);
    const otherDashboard = await getDashboardDataForUser(otherId);
    expect(ownerDashboard.activeTimers.map(({ id }) => id)).toEqual([timer.id]);
    expect(otherDashboard.activeTimers).toHaveLength(1);
    expect(otherDashboard.activeTimers[0].id).not.toBe(timer.id);
  });

  it("keeps completion blocking compatible with timer starts", async () => {
    const userId = await insertUser();
    const rootId = await insertNode(userId, "Root");
    const childId = await insertNode(userId, "Child", { parentId: rootId });
    await startTimerForUser(userId, childId, "2026-07-22");

    await expect(completeNodeForUser(userId, rootId)).rejects.toMatchObject({
      reason: "active-timers",
      blockingNodeIds: [childId],
    });
  });
});
