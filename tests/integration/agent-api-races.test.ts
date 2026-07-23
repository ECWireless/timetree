import { randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const allowedEmail = "agent-race-user@example.test";
const pool = new Pool({ connectionString });
const userIds = new Set<string>();

let nodesPOST: typeof import(
  "../../src/app/api/agent/v1/nodes/route"
).POST;
let timerPUT: typeof import(
  "../../src/app/api/agent/v1/nodes/[nodeId]/timer/route"
).PUT;
let timerDELETE: typeof import(
  "../../src/app/api/agent/v1/nodes/[nodeId]/timer/route"
).DELETE;
let createAgentApiKeyForUser: typeof import(
  "../../src/lib/server/agent-api-key-service"
).createAgentApiKeyForUser;
let revokeAgentApiKeyForUser: typeof import(
  "../../src/lib/server/agent-api-key-service"
).revokeAgentApiKeyForUser;
let rotateAgentApiKeyForUser: typeof import(
  "../../src/lib/server/agent-api-key-service"
).rotateAgentApiKeyForUser;
let deleteNodeForUser: typeof import(
  "../../src/lib/server/node-service"
).deleteNodeForUser;
let moveNodeForUser: typeof import(
  "../../src/lib/server/node-service"
).moveNodeForUser;
let stopTimerForUser: typeof import(
  "../../src/lib/server/timer-service"
).stopTimerForUser;
let TimerMutationError: typeof import(
  "../../src/lib/server/timer-service"
).TimerMutationError;

async function insertNode(
  userId: string,
  title: string,
  position: number,
  parentId: string | null = null,
) {
  const result = await pool.query<{ id: string }>(
    `insert into nodes (user_id, parent_id, position, title)
     values ($1, $2, $3, $4) returning id`,
    [userId, parentId, position, title],
  );
  return result.rows[0].id;
}

async function seedTree() {
  const userId = `agent-race-user-${randomUUID()}`;
  userIds.add(userId);
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Agent Race User', $2, true)`,
    [userId, allowedEmail],
  );
  const outsideRootId = await insertNode(userId, "Outside", 0);
  const rootNodeId = await insertNode(userId, "Scope", 1);
  const movableNodeId = await insertNode(
    userId,
    "Movable",
    0,
    rootNodeId,
  );
  const deletableNodeId = await insertNode(
    userId,
    "Deletable",
    1,
    rootNodeId,
  );
  const credential = await createAgentApiKeyForUser(userId, rootNodeId);
  return {
    userId,
    outsideRootId,
    rootNodeId,
    movableNodeId,
    deletableNodeId,
    apiKey: credential.apiKey,
    credentialId: credential.credential.id,
  };
}

function nodeRequest(apiKey: string, id: string, parentId: string) {
  return new Request("http://localhost/api/agent/v1/nodes", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ id, parentId, title: "Raced session" }),
  });
}

function timerRequest(apiKey: string, nodeId: string) {
  return new Request(
    `http://localhost/api/agent/v1/nodes/${nodeId}/timer`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ timeZone: "UTC" }),
    },
  );
}

function timerContext(nodeId: string) {
  return { params: Promise.resolve({ nodeId }) };
}

describe("agent scope mutation races", () => {
  beforeAll(async () => {
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "synthetic-agent-race-secret-for-tests-only",
    );
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-google-client-secret");
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);

    ({ POST: nodesPOST } = await import(
      "../../src/app/api/agent/v1/nodes/route"
    ));
    ({ DELETE: timerDELETE, PUT: timerPUT } = await import(
      "../../src/app/api/agent/v1/nodes/[nodeId]/timer/route"
    ));
    ({
      createAgentApiKeyForUser,
      revokeAgentApiKeyForUser,
      rotateAgentApiKeyForUser,
    } = await import("../../src/lib/server/agent-api-key-service"));
    ({ deleteNodeForUser, moveNodeForUser } = await import(
      "../../src/lib/server/node-service"
    ));
    ({ stopTimerForUser, TimerMutationError } = await import(
      "../../src/lib/server/timer-service"
    ));
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
    try {
      await pool.end();
    } finally {
      vi.unstubAllEnvs();
    }
  });

  it("linearizes creation against rotation and rejects the old key afterward", async () => {
    const tree = await seedTree();
    const createdId = randomUUID();
    const [response, rotated] = await Promise.all([
      nodesPOST(
        nodeRequest(tree.apiKey, createdId, tree.rootNodeId),
      ),
      rotateAgentApiKeyForUser(
        tree.userId,
        tree.rootNodeId,
        tree.credentialId,
      ),
    ]);

    expect([200, 401]).toContain(response.status);
    const stored = await pool.query<{ count: string }>(
      `select count(*) from nodes where user_id = $1 and id = $2`,
      [tree.userId, createdId],
    );
    expect(stored.rows[0].count).toBe(response.status === 200 ? "1" : "0");

    const oldKeyRetry = await nodesPOST(
      nodeRequest(tree.apiKey, randomUUID(), tree.rootNodeId),
    );
    expect(oldKeyRetry.status).toBe(401);
    const newKeyRequest = await nodesPOST(
      nodeRequest(rotated.apiKey, randomUUID(), tree.rootNodeId),
    );
    expect(newKeyRequest.status).toBe(200);
  });

  it("linearizes creation against revocation with no post-revocation commit", async () => {
    const tree = await seedTree();
    const createdId = randomUUID();
    const [response] = await Promise.all([
      nodesPOST(
        nodeRequest(tree.apiKey, createdId, tree.rootNodeId),
      ),
      revokeAgentApiKeyForUser(
        tree.userId,
        tree.rootNodeId,
        tree.credentialId,
      ),
    ]);

    expect([200, 401]).toContain(response.status);
    const stored = await pool.query<{ count: string }>(
      `select count(*) from nodes where user_id = $1 and id = $2`,
      [tree.userId, createdId],
    );
    expect(stored.rows[0].count).toBe(response.status === 200 ? "1" : "0");
    const retry = await nodesPOST(
      nodeRequest(tree.apiKey, randomUUID(), tree.rootNodeId),
    );
    expect(retry.status).toBe(401);
  });

  it("never creates beneath a node after it moves outside the scope", async () => {
    const tree = await seedTree();
    const createdId = randomUUID();
    const [response] = await Promise.all([
      nodesPOST(
        nodeRequest(tree.apiKey, createdId, tree.movableNodeId),
      ),
      moveNodeForUser(tree.userId, {
        id: tree.movableNodeId,
        parentId: tree.outsideRootId,
        position: 0,
      }),
    ]);

    expect([200, 404]).toContain(response.status);
    const created = await pool.query<{ parent_id: string }>(
      `select parent_id from nodes where user_id = $1 and id = $2`,
      [tree.userId, createdId],
    );
    if (response.status === 200) {
      expect(created.rows[0].parent_id).toBe(tree.movableNodeId);
    } else {
      expect(created.rows).toEqual([]);
    }

    const afterMove = await nodesPOST(
      nodeRequest(tree.apiKey, randomUUID(), tree.movableNodeId),
    );
    expect(afterMove.status).toBe(404);
  });

  it("serializes timer start against node deletion without orphaned state", async () => {
    const tree = await seedTree();
    const [response, deletion] = await Promise.allSettled([
      timerPUT(
        timerRequest(tree.apiKey, tree.deletableNodeId),
        timerContext(tree.deletableNodeId),
      ),
      deleteNodeForUser(tree.userId, tree.deletableNodeId),
    ]);
    if (response.status !== "fulfilled") {
      throw response.reason;
    }

    expect([200, 404]).toContain(response.value.status);
    const storedNode = await pool.query<{ count: string }>(
      `select count(*) from nodes where user_id = $1 and id = $2`,
      [tree.userId, tree.deletableNodeId],
    );
    const storedTimer = await pool.query<{ count: string }>(
      `select count(*) from active_timers where user_id = $1 and node_id = $2`,
      [tree.userId, tree.deletableNodeId],
    );
    if (response.value.status === 200) {
      expect(deletion.status).toBe("rejected");
      expect(storedNode.rows[0].count).toBe("1");
      expect(storedTimer.rows[0].count).toBe("1");
    } else {
      expect(deletion.status).toBe("fulfilled");
      expect(storedNode.rows[0].count).toBe("0");
      expect(storedTimer.rows[0].count).toBe("0");
    }
  });

  it("uses one lock order when dashboard and agent stops race", async () => {
    const tree = await seedTree();
    const timer = await pool.query<{ id: string }>(
      `insert into active_timers
         (user_id, node_id, started_at, work_date)
       values ($1, $2, $3, '2026-07-23') returning id`,
      [
        tree.userId,
        tree.deletableNodeId,
        new Date("2026-07-23T10:00:00.000Z"),
      ],
    );
    const endedAt = new Date("2026-07-23T10:01:00.000Z");

    const [agentResult, dashboardResult] = await Promise.allSettled([
      timerDELETE(
        new Request(
          `http://localhost/api/agent/v1/nodes/${tree.deletableNodeId}/timer`,
          {
            method: "DELETE",
            headers: { Authorization: `Bearer ${tree.apiKey}` },
          },
        ),
        timerContext(tree.deletableNodeId),
      ),
      stopTimerForUser(tree.userId, timer.rows[0].id, endedAt),
    ]);
    if (agentResult.status !== "fulfilled") {
      throw agentResult.reason;
    }
    const agentBody = (await agentResult.value.json()) as {
      status: "stopped" | "not-running";
    };

    expect(agentResult.value.status).toBe(200);
    expect(["stopped", "not-running"]).toContain(agentBody.status);
    if (dashboardResult.status === "rejected") {
      expect(agentBody.status).toBe("stopped");
      expect(dashboardResult.reason).toEqual(
        new TimerMutationError("timer-not-found"),
      );
    } else {
      expect(agentBody.status).toBe("not-running");
    }

    const timers = await pool.query<{ count: string }>(
      `select count(*) from active_timers
       where user_id = $1 and node_id = $2`,
      [tree.userId, tree.deletableNodeId],
    );
    const entries = await pool.query<{ count: string }>(
      `select count(*) from time_entries
       where user_id = $1 and node_id = $2`,
      [tree.userId, tree.deletableNodeId],
    );
    expect(timers.rows[0].count).toBe("0");
    expect(entries.rows[0].count).toBe("1");
  });
});
