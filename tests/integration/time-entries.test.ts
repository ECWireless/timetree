import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const pool = new Pool({ connectionString });
const userIds = new Set<string>();
let createTimeEntryForUser: typeof import(
  "../../src/lib/server/time-entry-service"
).createTimeEntryForUser;
let deleteTimeEntryForUser: typeof import(
  "../../src/lib/server/time-entry-service"
).deleteTimeEntryForUser;
let getNodeEntriesForUser: typeof import(
  "../../src/lib/server/time-entry-service"
).getNodeEntriesForUser;
let TimeEntryMutationError: typeof import(
  "../../src/lib/server/time-entry-service"
).TimeEntryMutationError;
let updateTimeEntryForUser: typeof import(
  "../../src/lib/server/time-entry-service"
).updateTimeEntryForUser;

async function insertUser() {
  const userId = `time-entry-user-${randomUUID()}`;
  userIds.add(userId);
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Time Entry User', $2, true)`,
    [userId, `${userId}@example.test`],
  );
  return userId;
}

async function insertNode(
  userId: string,
  title: string,
  options: {
    parentId?: string | null;
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

function durationInput(nodeId: string, overrides: Record<string, unknown> = {}) {
  return {
    mode: "duration" as const,
    nodeId,
    workDate: "2026-07-22",
    startedAt: null,
    endedAt: null,
    durationSeconds: 3_600,
    notes: null,
    ...overrides,
  };
}

describe("owner-scoped time-entry service", () => {
  beforeAll(async () => {
    ({
      createTimeEntryForUser,
      deleteTimeEntryForUser,
      getNodeEntriesForUser,
      TimeEntryMutationError,
      updateTimeEntryForUser,
    } = await import("../../src/lib/server/time-entry-service"));
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

  it("snapshots inherited, explicit-zero, override, and unpriced rates", async () => {
    const userId = await insertUser();
    const rootId = await insertNode(userId, "Root", { hourlyRateCents: 12_500 });
    const inheritedId = await insertNode(userId, "Inherited", { parentId: rootId });
    const zeroId = await insertNode(userId, "Zero", {
      parentId: rootId,
      position: 1,
      hourlyRateCents: 0,
    });
    const unpricedRootId = await insertNode(userId, "Unpriced", { position: 1 });

    await expect(createTimeEntryForUser(userId, durationInput(inheritedId))).resolves.toMatchObject({
      hourlyRateCents: 12_500,
    });
    await expect(createTimeEntryForUser(userId, durationInput(zeroId))).resolves.toMatchObject({
      hourlyRateCents: 0,
    });
    await expect(
      createTimeEntryForUser(userId, durationInput(inheritedId, { hourlyRateCents: 9_900 })),
    ).resolves.toMatchObject({ hourlyRateCents: 9_900 });
    await expect(
      createTimeEntryForUser(userId, durationInput(inheritedId, { hourlyRateCents: null })),
    ).resolves.toMatchObject({ hourlyRateCents: null });
    await expect(createTimeEntryForUser(userId, durationInput(unpricedRootId))).resolves.toMatchObject(
      { hourlyRateCents: null },
    );
  });

  it("creates entries on completed nodes", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId, "Completed", { completed: true });
    await expect(createTimeEntryForUser(userId, durationInput(nodeId))).resolves.toMatchObject({
      nodeId,
      durationSeconds: 3_600,
    });
  });

  it("preserves stored rate while correcting and reassigning an entry", async () => {
    const userId = await insertUser();
    const sourceId = await insertNode(userId, "Source", { hourlyRateCents: 12_500 });
    const destinationId = await insertNode(userId, "Destination", {
      position: 1,
      hourlyRateCents: 25_000,
      completed: true,
    });
    const newParentId = await insertNode(userId, "New rate parent", {
      position: 2,
      hourlyRateCents: 50_000,
    });
    const created = await createTimeEntryForUser(userId, durationInput(sourceId));
    await pool.query(`update nodes set parent_id = $1, position = 0 where id = $2`, [
      newParentId,
      sourceId,
    ]);
    await expect(getNodeEntriesForUser(userId, sourceId)).resolves.toMatchObject({
      entries: [{ id: created.id, hourlyRateCents: 12_500 }],
    });

    const updated = await updateTimeEntryForUser(
      userId,
      created.id,
      durationInput(destinationId, {
        workDate: "2026-07-23",
        durationSeconds: 7_200,
        notes: "Corrected synthetic note",
      }),
    );
    expect(updated).toMatchObject({
      nodeId: destinationId,
      workDate: "2026-07-23",
      durationSeconds: 7_200,
      hourlyRateCents: 12_500,
      notes: "Corrected synthetic note",
    });
  });

  it("changes a stored rate only when explicitly supplied", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId, "Node", { hourlyRateCents: 12_500 });
    const created = await createTimeEntryForUser(userId, durationInput(nodeId));

    await expect(
      updateTimeEntryForUser(userId, created.id, durationInput(nodeId, { hourlyRateCents: 0 })),
    ).resolves.toMatchObject({ hourlyRateCents: 0 });
    await expect(
      updateTimeEntryForUser(userId, created.id, durationInput(nodeId, { hourlyRateCents: null })),
    ).resolves.toMatchObject({ hourlyRateCents: null });
  });

  it("owner-scopes entry targets, assignments, reads, and deletion", async () => {
    const ownerId = await insertUser();
    const otherUserId = await insertUser();
    const ownerNodeId = await insertNode(ownerId, "Private");
    const otherNodeId = await insertNode(otherUserId, "Other");
    const created = await createTimeEntryForUser(ownerId, durationInput(ownerNodeId));

    await expect(getNodeEntriesForUser(otherUserId, ownerNodeId)).rejects.toEqual(
      new TimeEntryMutationError("node-not-found"),
    );
    await expect(
      updateTimeEntryForUser(ownerId, created.id, durationInput(otherNodeId)),
    ).rejects.toEqual(new TimeEntryMutationError("node-not-found"));
    await expect(deleteTimeEntryForUser(otherUserId, created.id)).rejects.toEqual(
      new TimeEntryMutationError("entry-not-found"),
    );
  });

  it("paginates newest-first with a stable created-at and id cursor", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId, "Paged");
    const insertedIds: string[] = [];
    for (let index = 0; index < 55; index += 1) {
      const created = await createTimeEntryForUser(
        userId,
        durationInput(nodeId, { notes: `Entry ${index}` }),
      );
      insertedIds.push(created.id);
      await pool.query(
        `update time_entries
         set created_at = timestamptz '2026-07-22T00:00:00.000000Z' + $1 * interval '1 microsecond'
         where id = $2`,
        [index, created.id],
      );
    }

    const first = await getNodeEntriesForUser(userId, nodeId);
    expect(first.entries).toHaveLength(50);
    expect(first.entries[0].notes).toBe("Entry 54");
    expect(first.nextCursor).not.toBeNull();

    await createTimeEntryForUser(userId, durationInput(nodeId, { notes: "Newer insertion" }));
    const second = await getNodeEntriesForUser(userId, nodeId, first.nextCursor!);
    expect(second.entries).toHaveLength(5);
    expect(second.entries.map(({ id }) => id)).toEqual(insertedIds.slice(0, 5).reverse());
  });

  it("permanently deletes an owned historical entry", async () => {
    const userId = await insertUser();
    const nodeId = await insertNode(userId, "Node");
    const created = await createTimeEntryForUser(userId, durationInput(nodeId));

    await expect(deleteTimeEntryForUser(userId, created.id)).resolves.toBe(created.id);
    await expect(deleteTimeEntryForUser(userId, created.id)).rejects.toEqual(
      new TimeEntryMutationError("entry-not-found"),
    );
  });
});
