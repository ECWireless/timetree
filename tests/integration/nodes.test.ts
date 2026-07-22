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
let getDashboardDataForUser: typeof import(
  "../../src/lib/server/node-service"
).getDashboardDataForUser;
let NodeMutationError: typeof import("../../src/lib/server/node-service").NodeMutationError;
let updateNodeForUser: typeof import("../../src/lib/server/node-service").updateNodeForUser;

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
    ({ createNodeForUser, getDashboardDataForUser, NodeMutationError, updateNodeForUser } =
      await import("../../src/lib/server/node-service"));
  });

  afterEach(async () => {
    if (userIds.size > 0) {
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
});
