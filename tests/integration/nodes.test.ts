import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const pool = new Pool({ connectionString });
const userIds = new Set<string>();
let createNodeForUser: typeof import("../../src/lib/server/node-service").createNodeForUser;
let completeNodeForUser: typeof import("../../src/lib/server/node-service").completeNodeForUser;
let deleteNodeForUser: typeof import("../../src/lib/server/node-service").deleteNodeForUser;
let getDashboardDataForUser: typeof import(
  "../../src/lib/server/node-service"
).getDashboardDataForUser;
let moveNodeForUser: typeof import("../../src/lib/server/node-service").moveNodeForUser;
let NodeMutationError: typeof import("../../src/lib/server/node-service").NodeMutationError;
let reopenNodeForUser: typeof import("../../src/lib/server/node-service").reopenNodeForUser;
let updateNodeForUser: typeof import("../../src/lib/server/node-service").updateNodeForUser;
let withLockedIncompleteNodeForUser: typeof import(
  "../../src/lib/server/node-service"
).withLockedIncompleteNodeForUser;

async function insertUser() {
  const userId = `node-user-${randomUUID()}`;
  userIds.add(userId);
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Node User', $2, true)`,
    [userId, `${userId}@example.test`],
  );
  return userId;
}

describe("owner-scoped node service", () => {
  beforeAll(async () => {
    ({
      completeNodeForUser,
      createNodeForUser,
      deleteNodeForUser,
      getDashboardDataForUser,
      moveNodeForUser,
      NodeMutationError,
      reopenNodeForUser,
      updateNodeForUser,
      withLockedIncompleteNodeForUser,
    } = await import("../../src/lib/server/node-service"));
  });

  afterEach(async () => {
    if (userIds.size > 0) {
      await pool.query(`delete from active_timers where user_id = any($1::text[])`, [[...userIds]]);
      await pool.query(`delete from time_entries where user_id = any($1::text[])`, [[...userIds]]);
      await pool.query(`delete from "user" where id = any($1::text[])`, [[...userIds]]);
      userIds.clear();
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("creates roots and children only beneath an owner-scoped parent", async () => {
    const ownerId = await insertUser();
    const otherUserId = await insertUser();
    const root = await createNodeForUser(ownerId, { title: "Root" });
    const child = await createNodeForUser(ownerId, { title: "Child", parentId: root.id });

    expect(child.parentId).toBe(root.id);
    await expect(
      createNodeForUser(otherUserId, { title: "Cross-owner child", parentId: root.id }),
    ).rejects.toEqual(new NodeMutationError("parent-not-found"));
  });

  it("updates only a node owned by the supplied owner", async () => {
    const ownerId = await insertUser();
    const otherUserId = await insertUser();
    const node = await createNodeForUser(ownerId, { title: "Original" });

    await expect(
      updateNodeForUser(otherUserId, { id: node.id, title: "Not allowed" }),
    ).rejects.toEqual(new NodeMutationError("node-not-found"));

    const updated = await updateNodeForUser(ownerId, {
      id: node.id,
      title: "Updated",
      description: "Synthetic description",
      hourlyRateCents: 0,
    });
    expect(updated).toMatchObject({
      title: "Updated",
      description: "Synthetic description",
      hourlyRateCents: 0,
    });
  });

  it("returns ordered hierarchy, breadcrumbs, and inherited rates", async () => {
    const ownerId = await insertUser();
    const root = await createNodeForUser(ownerId, { title: "Root" });
    await updateNodeForUser(ownerId, { id: root.id, hourlyRateCents: 15_000 });
    const child = await createNodeForUser(ownerId, { title: "Child", parentId: root.id });
    await createNodeForUser(ownerId, { title: "Second root" });

    const dashboard = await getDashboardDataForUser(ownerId);

    expect(dashboard.roots.map(({ title }) => title)).toEqual(["Root", "Second root"]);
    expect(dashboard.orderedNodes.find(({ id }) => id === child.id)).toMatchObject({
      resolvedHourlyRateCents: 15_000,
      breadcrumb: [{ title: "Root" }, { title: "Child" }],
    });
  });

  it("keeps concurrent sibling positions unique and contiguous", async () => {
    const ownerId = await insertUser();
    await Promise.all(
      Array.from({ length: 12 }, (_, index) =>
        createNodeForUser(ownerId, { title: `Concurrent ${index}` }),
      ),
    );

    const result = await pool.query<{ position: number }>(
      `select position from nodes where user_id = $1 and parent_id is null order by position`,
      [ownerId],
    );
    expect(result.rows.map(({ position }) => position)).toEqual(
      Array.from({ length: 12 }, (_, index) => index),
    );
  });

  it("reparents and reorders nodes while keeping both sibling groups contiguous", async () => {
    const ownerId = await insertUser();
    const firstRoot = await createNodeForUser(ownerId, { title: "First root" });
    const secondRoot = await createNodeForUser(ownerId, { title: "Second root" });
    const thirdRoot = await createNodeForUser(ownerId, { title: "Third root" });
    const firstChild = await createNodeForUser(ownerId, {
      title: "First child",
      parentId: firstRoot.id,
    });

    await moveNodeForUser(ownerId, { id: thirdRoot.id, parentId: null, position: 0 });
    await moveNodeForUser(ownerId, {
      id: secondRoot.id,
      parentId: firstRoot.id,
      position: 0,
    });

    const result = await pool.query<{
      id: string;
      parent_id: string | null;
      position: number;
    }>(
      `select id, parent_id, position
       from nodes
       where user_id = $1
       order by parent_id nulls first, position`,
      [ownerId],
    );
    expect(result.rows).toEqual([
      { id: thirdRoot.id, parent_id: null, position: 0 },
      { id: firstRoot.id, parent_id: null, position: 1 },
      { id: secondRoot.id, parent_id: firstRoot.id, position: 0 },
      { id: firstChild.id, parent_id: firstRoot.id, position: 1 },
    ]);
  });

  it("rejects invalid move destinations without changing the tree", async () => {
    const ownerId = await insertUser();
    const otherUserId = await insertUser();
    const root = await createNodeForUser(ownerId, { title: "Root" });
    const child = await createNodeForUser(ownerId, { title: "Child", parentId: root.id });
    const grandchild = await createNodeForUser(ownerId, {
      title: "Grandchild",
      parentId: child.id,
    });
    const otherRoot = await createNodeForUser(otherUserId, { title: "Other root" });

    await expect(
      moveNodeForUser(ownerId, { id: root.id, parentId: grandchild.id }),
    ).rejects.toEqual(new NodeMutationError("cycle"));
    await expect(
      moveNodeForUser(ownerId, { id: child.id, parentId: otherRoot.id }),
    ).rejects.toEqual(new NodeMutationError("parent-not-found"));
    await expect(
      moveNodeForUser(ownerId, { id: child.id, parentId: null, position: 3 }),
    ).rejects.toEqual(new NodeMutationError("invalid-position"));

    const stored = await pool.query<{ parent_id: string | null }>(
      `select parent_id from nodes where user_id = $1 and id = $2`,
      [ownerId, child.id],
    );
    expect(stored.rows[0].parent_id).toBe(root.id);
  });

  it("rejects new or moved incomplete nodes beneath a completed parent", async () => {
    const ownerId = await insertUser();
    const source = await createNodeForUser(ownerId, { title: "Source" });
    const destination = await createNodeForUser(ownerId, { title: "Destination" });
    await completeNodeForUser(ownerId, destination.id);

    await expect(
      createNodeForUser(ownerId, { title: "New child", parentId: destination.id }),
    ).rejects.toEqual(new NodeMutationError("parent-completed"));
    await expect(
      moveNodeForUser(ownerId, { id: source.id, parentId: destination.id }),
    ).rejects.toEqual(new NodeMutationError("parent-completed"));
  });

  it("owner-scopes every lifecycle target", async () => {
    const ownerId = await insertUser();
    const otherUserId = await insertUser();
    const node = await createNodeForUser(ownerId, { title: "Private node" });

    await expect(completeNodeForUser(otherUserId, node.id)).rejects.toEqual(
      new NodeMutationError("node-not-found"),
    );
    await expect(reopenNodeForUser(otherUserId, node.id)).rejects.toEqual(
      new NodeMutationError("node-not-found"),
    );
    await expect(deleteNodeForUser(otherUserId, node.id)).rejects.toEqual(
      new NodeMutationError("node-not-found"),
    );
  });

  it("completes every incomplete descendant and preserves prior completion timestamps", async () => {
    const ownerId = await insertUser();
    const root = await createNodeForUser(ownerId, { title: "Root" });
    const child = await createNodeForUser(ownerId, { title: "Child", parentId: root.id });
    const grandchild = await createNodeForUser(ownerId, {
      title: "Grandchild",
      parentId: child.id,
    });
    const priorCompletion = new Date("2025-01-02T03:04:05.000Z");
    await pool.query(`update nodes set completed_at = $1 where id = $2`, [
      priorCompletion,
      grandchild.id,
    ]);

    await completeNodeForUser(ownerId, root.id);

    const result = await pool.query<{ id: string; completed_at: Date }>(
      `select id, completed_at from nodes where user_id = $1 order by id`,
      [ownerId],
    );
    expect(result.rows.every(({ completed_at }) => completed_at instanceof Date)).toBe(true);
    expect(result.rows.find(({ id }) => id === grandchild.id)?.completed_at).toEqual(
      priorCompletion,
    );
  });

  it("reopens only the selected node and its completed ancestor path", async () => {
    const ownerId = await insertUser();
    const root = await createNodeForUser(ownerId, { title: "Root" });
    const child = await createNodeForUser(ownerId, { title: "Child", parentId: root.id });
    const grandchild = await createNodeForUser(ownerId, {
      title: "Grandchild",
      parentId: child.id,
    });
    const sibling = await createNodeForUser(ownerId, {
      title: "Sibling",
      parentId: child.id,
    });
    const descendant = await createNodeForUser(ownerId, {
      title: "Descendant",
      parentId: grandchild.id,
    });
    await completeNodeForUser(ownerId, root.id);

    await reopenNodeForUser(ownerId, grandchild.id);

    const result = await pool.query<{ id: string; completed_at: Date | null }>(
      `select id, completed_at from nodes where user_id = $1`,
      [ownerId],
    );
    expect(result.rows.find(({ id }) => id === root.id)?.completed_at).toBeNull();
    expect(result.rows.find(({ id }) => id === child.id)?.completed_at).toBeNull();
    expect(result.rows.find(({ id }) => id === grandchild.id)?.completed_at).toBeNull();
    expect(result.rows.find(({ id }) => id === sibling.id)?.completed_at).not.toBeNull();
    expect(result.rows.find(({ id }) => id === descendant.id)?.completed_at).not.toBeNull();
  });

  it("blocks completion and deletion when a subtree has an active timer", async () => {
    const ownerId = await insertUser();
    const root = await createNodeForUser(ownerId, { title: "Root" });
    const child = await createNodeForUser(ownerId, { title: "Child", parentId: root.id });
    await pool.query(
      `insert into active_timers (user_id, node_id, started_at, work_date)
       values ($1, $2, now(), '2026-07-22')`,
      [ownerId, child.id],
    );

    await expect(completeNodeForUser(ownerId, root.id)).rejects.toEqual(
      new NodeMutationError("active-timers", [child.id]),
    );
    await expect(deleteNodeForUser(ownerId, root.id)).rejects.toEqual(
      new NodeMutationError("active-timers", [child.id]),
    );
  });

  it("deletes only history-free subtrees and closes the sibling position gap", async () => {
    const ownerId = await insertUser();
    const first = await createNodeForUser(ownerId, { title: "First" });
    const second = await createNodeForUser(ownerId, { title: "Second" });
    const child = await createNodeForUser(ownerId, { title: "Child", parentId: second.id });
    const third = await createNodeForUser(ownerId, { title: "Third" });

    await deleteNodeForUser(ownerId, second.id);

    const result = await pool.query<{ id: string; position: number }>(
      `select id, position from nodes where user_id = $1 order by position`,
      [ownerId],
    );
    expect(result.rows).toEqual([
      { id: first.id, position: 0 },
      { id: third.id, position: 1 },
    ]);
    expect(result.rows.some(({ id }) => id === child.id)).toBe(false);
  });

  it("blocks deletion when historical time exists anywhere in the subtree", async () => {
    const ownerId = await insertUser();
    const root = await createNodeForUser(ownerId, { title: "Root" });
    const child = await createNodeForUser(ownerId, { title: "Child", parentId: root.id });
    await pool.query(
      `insert into time_entries (user_id, node_id, work_date, duration_seconds)
       values ($1, $2, '2026-07-22', 60)`,
      [ownerId, child.id],
    );

    await expect(deleteNodeForUser(ownerId, root.id)).rejects.toEqual(
      new NodeMutationError("history-exists", [child.id]),
    );
  });

  it("preserves lifecycle invariants when a destination completes during a move", async () => {
    const ownerId = await insertUser();
    const source = await createNodeForUser(ownerId, { title: "Source" });
    const destination = await createNodeForUser(ownerId, { title: "Destination" });

    const [completion, move] = await Promise.allSettled([
      completeNodeForUser(ownerId, destination.id),
      moveNodeForUser(ownerId, { id: source.id, parentId: destination.id }),
    ]);

    expect(completion.status).toBe("fulfilled");
    if (move.status === "rejected") {
      expect(move.reason).toEqual(new NodeMutationError("parent-completed"));
    }

    const result = await pool.query<{
      id: string;
      parent_id: string | null;
      completed_at: Date | null;
    }>(`select id, parent_id, completed_at from nodes where user_id = $1`, [ownerId]);
    const storedSource = result.rows.find(({ id }) => id === source.id);
    const storedDestination = result.rows.find(({ id }) => id === destination.id);
    expect(storedDestination?.completed_at).not.toBeNull();
    expect(
      storedSource?.parent_id !== destination.id || storedSource.completed_at !== null,
    ).toBe(true);
  });

  it("preserves lifecycle invariants when timer start races recursive completion", async () => {
    const ownerId = await insertUser();
    const root = await createNodeForUser(ownerId, { title: "Root" });
    const child = await createNodeForUser(ownerId, { title: "Child", parentId: root.id });

    const [completion, timerStart] = await Promise.allSettled([
      completeNodeForUser(ownerId, root.id),
      withLockedIncompleteNodeForUser(ownerId, child.id, async ({ insertActiveTimer }) => {
        await insertActiveTimer({
          startedAt: new Date(),
          workDate: "2026-07-22",
        });
      }),
    ]);

    if (completion.status === "fulfilled") {
      expect(timerStart.status).toBe("rejected");
      if (timerStart.status === "rejected") {
        expect(timerStart.reason).toEqual(new NodeMutationError("node-completed"));
      }
    } else {
      expect(completion.reason).toEqual(new NodeMutationError("active-timers", [child.id]));
      expect(timerStart.status).toBe("fulfilled");
    }

    const result = await pool.query<{ completed_at: Date | null; timer_count: string }>(
      `select nodes.completed_at, count(active_timers.id)::text as timer_count
       from nodes
       left join active_timers on active_timers.node_id = nodes.id
       where nodes.user_id = $1 and nodes.id = $2
       group by nodes.completed_at`,
      [ownerId, child.id],
    );
    const stored = result.rows[0];
    expect(stored.completed_at === null ? stored.timer_count === "1" : stored.timer_count === "0").toBe(
      true,
    );
  });

  it("binds timer insertion to the incomplete node validated by the lock boundary", async () => {
    const ownerId = await insertUser();
    const incomplete = await createNodeForUser(ownerId, { title: "Incomplete" });
    const completed = await createNodeForUser(ownerId, { title: "Completed" });
    await completeNodeForUser(ownerId, completed.id);

    await withLockedIncompleteNodeForUser(
      ownerId,
      incomplete.id,
      async ({ insertActiveTimer }) => {
        await insertActiveTimer({
          startedAt: new Date(),
          workDate: "2026-07-22",
          nodeId: completed.id,
        } as Parameters<typeof insertActiveTimer>[0]);
      },
    );

    const result = await pool.query<{ node_id: string }>(
      `select node_id from active_timers where user_id = $1`,
      [ownerId],
    );
    expect(result.rows).toEqual([{ node_id: incomplete.id }]);
  });

  it("preserves references when historical insertion races subtree deletion", async () => {
    const ownerId = await insertUser();
    const node = await createNodeForUser(ownerId, { title: "Race target" });

    const [deletion, insertion] = await Promise.allSettled([
      deleteNodeForUser(ownerId, node.id),
      pool.query(
        `insert into time_entries (user_id, node_id, work_date, duration_seconds)
         values ($1, $2, '2026-07-22', 60)`,
        [ownerId, node.id],
      ),
    ]);

    expect([deletion.status, insertion.status].sort()).toEqual(["fulfilled", "rejected"]);
    if (deletion.status === "rejected") {
      expect(deletion.reason).toEqual(new NodeMutationError("history-exists", [node.id]));
    } else if (insertion.status === "rejected") {
      expect(insertion.reason).toMatchObject({
        code: "23503",
        constraint: "time_entries_node_owner_fk",
      });
    }

    const result = await pool.query<{ node_count: string; entry_count: string }>(
      `select
         (select count(*) from nodes where user_id = $1 and id = $2)::text as node_count,
         (select count(*) from time_entries where user_id = $1 and node_id = $2)::text as entry_count`,
      [ownerId, node.id],
    );
    expect(result.rows[0]).toEqual(
      deletion.status === "fulfilled"
        ? { node_count: "0", entry_count: "0" }
        : { node_count: "1", entry_count: "1" },
    );
  });
});
