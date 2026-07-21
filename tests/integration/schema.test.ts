import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const pool = new Pool({ connectionString });
let client: PoolClient;

async function insertUser(id: string) {
  await client.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic User', $2, true)`,
    [id, `${id}@example.test`],
  );
}

async function insertNode(userId: string, position: number, parentId: string | null = null) {
  const result = await client.query<{ id: string }>(
    `insert into nodes (user_id, parent_id, position, title)
     values ($1, $2, $3, $4)
     returning id`,
    [userId, parentId, position, `Synthetic node ${randomUUID()}`],
  );

  return result.rows[0].id;
}

describe("initial PostgreSQL schema", () => {
  beforeAll(async () => {
    const result = await pool.query<{ nodes: string | null }>(
      "select to_regclass('public.nodes')::text as nodes",
    );

    if (result.rows[0].nodes !== "nodes") {
      throw new Error("The committed migrations must be applied before integration tests run.");
    }
  });

  beforeEach(async () => {
    client = await pool.connect();
    await client.query("begin");
  });

  afterEach(async () => {
    await client.query("rollback");
    client.release();
  });

  afterAll(async () => {
    await pool.end();
  });

  it("rejects a parent owned by another user", async () => {
    const firstUserId = `user-${randomUUID()}`;
    const secondUserId = `user-${randomUUID()}`;
    await insertUser(firstUserId);
    await insertUser(secondUserId);
    const firstUserNodeId = await insertNode(firstUserId, 0);

    await expect(insertNode(secondUserId, 0, firstUserNodeId)).rejects.toMatchObject({
      code: "23503",
      constraint: "nodes_parent_owner_fk",
    });
  });

  it("treats root positions as one deferrable sibling group", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(userId);
    const firstNodeId = await insertNode(userId, 0);
    const secondNodeId = await insertNode(userId, 1);

    await client.query("set constraints nodes_sibling_position_unique deferred");
    await client.query("update nodes set position = 1 where id = $1", [firstNodeId]);
    await client.query("update nodes set position = 0 where id = $1", [secondNodeId]);
    await client.query("set constraints nodes_sibling_position_unique immediate");

    const result = await client.query<{ id: string; position: number }>(
      "select id, position from nodes where user_id = $1 order by position",
      [userId],
    );
    expect(result.rows).toEqual([
      { id: secondNodeId, position: 0 },
      { id: firstNodeId, position: 1 },
    ]);
  });

  it("rejects duplicate root sibling positions", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(userId);
    await insertNode(userId, 0);

    await expect(insertNode(userId, 0)).rejects.toMatchObject({
      code: "23505",
      constraint: "nodes_sibling_position_unique",
    });
  });

  it("allows only one active timer per owner and node", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(userId);
    const nodeId = await insertNode(userId, 0);
    const values = [userId, nodeId, "2026-07-21"];

    await client.query(
      `insert into active_timers (user_id, node_id, started_at, work_date)
       values ($1, $2, now(), $3)`,
      values,
    );

    await expect(
      client.query(
        `insert into active_timers (user_id, node_id, started_at, work_date)
         values ($1, $2, now(), $3)`,
        values,
      ),
    ).rejects.toMatchObject({
      code: "23505",
      constraint: "active_timers_user_node_unique",
    });
  });

  it("rejects an active timer owned by someone other than its node owner", async () => {
    const nodeOwnerId = `user-${randomUUID()}`;
    const otherUserId = `user-${randomUUID()}`;
    await insertUser(nodeOwnerId);
    await insertUser(otherUserId);
    const nodeId = await insertNode(nodeOwnerId, 0);

    await expect(
      client.query(
        `insert into active_timers (user_id, node_id, started_at, work_date)
         values ($1, $2, now(), $3)`,
        [otherUserId, nodeId, "2026-07-21"],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "active_timers_node_owner_fk",
    });
  });

  it("rejects historical time owned by someone other than its node owner", async () => {
    const nodeOwnerId = `user-${randomUUID()}`;
    const otherUserId = `user-${randomUUID()}`;
    await insertUser(nodeOwnerId);
    await insertUser(otherUserId);
    const nodeId = await insertNode(nodeOwnerId, 0);

    await expect(
      client.query(
        `insert into time_entries (user_id, node_id, work_date, duration_seconds)
         values ($1, $2, $3, 60)`,
        [otherUserId, nodeId, "2026-07-21"],
      ),
    ).rejects.toMatchObject({
      code: "23503",
      constraint: "time_entries_node_owner_fk",
    });
  });

  it("rejects non-positive historical durations", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(userId);
    const nodeId = await insertNode(userId, 0);

    await expect(
      client.query(
        `insert into time_entries (user_id, node_id, work_date, duration_seconds)
         values ($1, $2, $3, 0)`,
        [userId, nodeId, "2026-07-21"],
      ),
    ).rejects.toMatchObject({
      code: "23514",
      constraint: "time_entries_duration_positive_check",
    });
  });

  it("prevents node deletion while historical time exists", async () => {
    const userId = `user-${randomUUID()}`;
    await insertUser(userId);
    const nodeId = await insertNode(userId, 0);

    await client.query(
      `insert into time_entries (user_id, node_id, work_date, duration_seconds)
       values ($1, $2, $3, 60)`,
      [userId, nodeId, "2026-07-21"],
    );

    await expect(client.query("delete from nodes where id = $1", [nodeId])).rejects.toMatchObject({
      code: "23503",
      constraint: "time_entries_node_owner_fk",
    });
  });
});
