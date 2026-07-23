import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { getWorkDateInTimeZone } from "../../src/lib/agent/time-zone";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const allowedEmail = "agent-api-user@example.test";
const pool = new Pool({ connectionString });
const userIds = new Set<string>();

let treeGET: typeof import(
  "../../src/app/api/agent/v1/tree/route"
).GET;
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
let moveNodeForUser: typeof import(
  "../../src/lib/server/node-service"
).moveNodeForUser;

async function insertNode(
  userId: string,
  input: {
    title: string;
    parentId?: string;
    position: number;
    completed?: boolean;
    hourlyRateCents?: number;
  },
) {
  const result = await pool.query<{ id: string }>(
    `insert into nodes
       (user_id, parent_id, position, title, completed_at, hourly_rate_cents)
     values ($1, $2, $3, $4, $5, $6) returning id`,
    [
      userId,
      input.parentId ?? null,
      input.position,
      input.title,
      input.completed ? new Date("2026-07-01T00:00:00.000Z") : null,
      input.hourlyRateCents ?? null,
    ],
  );
  return result.rows[0].id;
}

async function seedTree() {
  const userId = `agent-api-user-${randomUUID()}`;
  userIds.add(userId);
  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Agent API User', $2, true)`,
    [userId, allowedEmail],
  );
  const outsideParentId = await insertNode(userId, {
    title: "Private parent",
    position: 0,
    hourlyRateCents: 12_500,
  });
  const rootNodeId = await insertNode(userId, {
    title: "Agent scope",
    parentId: outsideParentId,
    position: 0,
  });
  const childNodeId = await insertNode(userId, {
    title: "Existing child",
    parentId: rootNodeId,
    position: 0,
  });
  const completedNodeId = await insertNode(userId, {
    title: "Completed child",
    parentId: rootNodeId,
    position: 1,
    completed: true,
  });
  const siblingNodeId = await insertNode(userId, {
    title: "Private sibling",
    parentId: outsideParentId,
    position: 1,
  });
  const credential = await createAgentApiKeyForUser(userId, rootNodeId);

  return {
    userId,
    outsideParentId,
    rootNodeId,
    childNodeId,
    completedNodeId,
    siblingNodeId,
    apiKey: credential.apiKey,
    credentialId: credential.credential.id,
  };
}

function authorizationHeaders(apiKey: string) {
  return {
    Authorization: `Bearer ${apiKey}`,
  };
}

function jsonRequest(url: string, apiKey: string, body: unknown) {
  return new Request(url, {
    method: "POST",
    headers: {
      ...authorizationHeaders(apiKey),
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });
}

function timerContext(nodeId: string) {
  return { params: Promise.resolve({ nodeId }) };
}

async function readJson(response: Response) {
  return response.json() as Promise<Record<string, unknown>>;
}

describe("scoped agent API", () => {
  beforeAll(async () => {
    vi.stubEnv(
      "BETTER_AUTH_SECRET",
      "synthetic-agent-api-secret-for-tests-only",
    );
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-google-client-secret");
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);

    ({ GET: treeGET } = await import(
      "../../src/app/api/agent/v1/tree/route"
    ));
    ({ POST: nodesPOST } = await import(
      "../../src/app/api/agent/v1/nodes/route"
    ));
    ({ DELETE: timerDELETE, PUT: timerPUT } = await import(
      "../../src/app/api/agent/v1/nodes/[nodeId]/timer/route"
    ));
    ({ createAgentApiKeyForUser, revokeAgentApiKeyForUser } = await import(
      "../../src/lib/server/agent-api-key-service"
    ));
    ({ moveNodeForUser } = await import("../../src/lib/server/node-service"));
  });

  afterEach(async () => {
    process.env.ALLOWED_EMAIL = allowedEmail;
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

  it("authenticates before request validation and returns bounded no-store errors", async () => {
    const tree = await seedTree();
    const malformedWithoutKey = new Request(
      "http://localhost/api/agent/v1/nodes",
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{",
      },
    );
    const unauthenticated = await nodesPOST(malformedWithoutKey);
    expect(unauthenticated.status).toBe(401);
    expect(unauthenticated.headers.get("cache-control")).toBe("no-store");
    expect(await readJson(unauthenticated)).toEqual({
      code: "invalid-key",
      message: "The agent API key is missing or invalid.",
    });

    const malformedWithKey = new Request(
      "http://localhost/api/agent/v1/nodes",
      {
        method: "POST",
        headers: {
          ...authorizationHeaders(tree.apiKey),
          "Content-Type": "application/json",
        },
        body: "{",
      },
    );
    const invalidJson = await nodesPOST(malformedWithKey);
    expect(invalidJson.status).toBe(400);
    expect(await readJson(invalidJson)).toMatchObject({
      code: "invalid-request",
      fields: { body: ["Provide a valid JSON request body."] },
    });

    const oversized = await nodesPOST(
      jsonRequest(
        "http://localhost/api/agent/v1/nodes",
        tree.apiKey,
        {
          id: randomUUID(),
          parentId: tree.rootNodeId,
          title: "x".repeat(9_000),
        },
      ),
    );
    expect(oversized.status).toBe(400);
    expect(await readJson(oversized)).toMatchObject({
      code: "invalid-request",
      fields: { body: ["Use a smaller JSON request body."] },
    });

    const invalidPathWithoutKey = await timerDELETE(
      new Request(
        "http://localhost/api/agent/v1/nodes/invalid/timer",
        { method: "DELETE" },
      ),
      timerContext("invalid"),
    );
    expect(invalidPathWithoutKey.status).toBe(401);
    const invalidPathWithKey = await timerDELETE(
      new Request(
        "http://localhost/api/agent/v1/nodes/invalid/timer",
        {
          method: "DELETE",
          headers: authorizationHeaders(tree.apiKey),
        },
      ),
      timerContext("invalid"),
    );
    expect(invalidPathWithKey.status).toBe(400);
    expect(await readJson(invalidPathWithKey)).toMatchObject({
      code: "invalid-request",
      fields: { nodeId: ["Use a valid node identifier."] },
    });
  });

  it("returns only the dynamically scoped ordered tree and allowlisted timer state", async () => {
    const tree = await seedTree();
    await pool.query(
      `insert into active_timers
         (user_id, node_id, started_at, work_date, hourly_rate_cents)
       values
         ($1, $2, $4, '2026-07-23', 12500),
         ($1, $3, $4, '2026-07-23', null)`,
      [
        tree.userId,
        tree.childNodeId,
        tree.siblingNodeId,
        new Date("2026-07-23T10:00:00.000Z"),
      ],
    );

    const response = await treeGET(
      new Request("http://localhost/api/agent/v1/tree", {
        headers: authorizationHeaders(tree.apiKey),
      }),
    );
    const body = await readJson(response);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toEqual({
      rootId: tree.rootNodeId,
      nodes: [
        {
          id: tree.rootNodeId,
          parentId: null,
          title: "Agent scope",
          description: null,
          completedAt: null,
          activeTimer: null,
        },
        {
          id: tree.childNodeId,
          parentId: tree.rootNodeId,
          title: "Existing child",
          description: null,
          completedAt: null,
          activeTimer: {
            startedAt: "2026-07-23T10:00:00.000Z",
            workDate: "2026-07-23",
          },
        },
        {
          id: tree.completedNodeId,
          parentId: tree.rootNodeId,
          title: "Completed child",
          description: null,
          completedAt: "2026-07-01T00:00:00.000Z",
          activeTimer: null,
        },
      ],
    });
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(tree.outsideParentId);
    expect(serialized).not.toContain(tree.siblingNodeId);
    expect(serialized).not.toContain(tree.userId);
    expect(serialized).not.toContain(tree.credentialId);
    expect(serialized).not.toContain("hourlyRate");
    expect(serialized).not.toContain("Private");
  });

  it("follows nodes moved out of and into the current subtree", async () => {
    const tree = await seedTree();
    await moveNodeForUser(tree.userId, {
      id: tree.childNodeId,
      parentId: tree.outsideParentId,
      position: 2,
    });
    await moveNodeForUser(tree.userId, {
      id: tree.siblingNodeId,
      parentId: tree.rootNodeId,
      position: 1,
    });

    const response = await treeGET(
      new Request("http://localhost/api/agent/v1/tree", {
        headers: authorizationHeaders(tree.apiKey),
      }),
    );
    const body = await readJson(response);
    const nodeIds = (body.nodes as Array<{ id: string }>).map(({ id }) => id);
    expect(nodeIds).toEqual([
      tree.rootNodeId,
      tree.completedNodeId,
      tree.siblingNodeId,
    ]);
    expect(JSON.stringify(body)).not.toContain(tree.childNodeId);
    expect(body.nodes).toContainEqual(
      expect.objectContaining({
        id: tree.siblingNodeId,
        parentId: tree.rootNodeId,
      }),
    );
  });

  it("creates replay-safe children without revealing outside identifier collisions", async () => {
    const tree = await seedTree();
    const createdId = randomUUID();
    const createdResponse = await nodesPOST(
      jsonRequest(
        "http://localhost/api/agent/v1/nodes",
        tree.apiKey,
        {
          id: createdId,
          parentId: tree.rootNodeId,
          title: "  Agent session  ",
        },
      ),
    );
    expect(createdResponse.status).toBe(200);
    expect(await readJson(createdResponse)).toEqual({
      status: "created",
      node: {
        id: createdId,
        parentId: tree.rootNodeId,
        title: "Agent session",
        description: null,
        completedAt: null,
        activeTimer: null,
      },
    });

    const replay = await nodesPOST(
      jsonRequest(
        "http://localhost/api/agent/v1/nodes",
        tree.apiKey,
        {
          id: createdId,
          parentId: tree.childNodeId,
          title: "Different replay input",
        },
      ),
    );
    expect(await readJson(replay)).toMatchObject({
      status: "existing",
      node: {
        id: createdId,
        parentId: tree.rootNodeId,
        title: "Agent session",
      },
    });

    const outsideCollision = await nodesPOST(
      jsonRequest(
        "http://localhost/api/agent/v1/nodes",
        tree.apiKey,
        {
          id: tree.siblingNodeId,
          parentId: tree.rootNodeId,
          title: "Collision",
        },
      ),
    );
    expect(outsideCollision.status).toBe(409);
    expect(await readJson(outsideCollision)).toEqual({
      code: "node-id-conflict",
      message: "Use a new randomly generated node identifier.",
    });

    const outsideParent = await nodesPOST(
      jsonRequest(
        "http://localhost/api/agent/v1/nodes",
        tree.apiKey,
        {
          id: randomUUID(),
          parentId: tree.siblingNodeId,
          title: "Outside",
        },
      ),
    );
    const missingParent = await nodesPOST(
      jsonRequest(
        "http://localhost/api/agent/v1/nodes",
        tree.apiKey,
        {
          id: randomUUID(),
          parentId: randomUUID(),
          title: "Missing",
        },
      ),
    );
    expect(await readJson(outsideParent)).toEqual(
      await readJson(missingParent),
    );
    expect(outsideParent.status).toBe(404);

    const completedParent = await nodesPOST(
      jsonRequest(
        "http://localhost/api/agent/v1/nodes",
        tree.apiKey,
        {
          id: randomUUID(),
          parentId: tree.completedNodeId,
          title: "Blocked",
        },
      ),
    );
    expect(completedParent.status).toBe(409);
    expect(await readJson(completedParent)).toMatchObject({
      code: "parent-completed",
    });
  });

  it("starts and stops idempotently using a server timestamp and inherited rate snapshot", async () => {
    const tree = await seedTree();
    const startRequest = () =>
      new Request(
        `http://localhost/api/agent/v1/nodes/${tree.childNodeId}/timer`,
        {
          method: "PUT",
          headers: {
            ...authorizationHeaders(tree.apiKey),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ timeZone: "America/Los_Angeles" }),
        },
      );

    const startedResponse = await timerPUT(
      startRequest(),
      timerContext(tree.childNodeId),
    );
    const started = await readJson(startedResponse);
    expect(startedResponse.status).toBe(200);
    expect(started).toMatchObject({
      nodeId: tree.childNodeId,
      status: "started",
      activeTimer: {
        startedAt: expect.any(String),
        workDate: expect.any(String),
      },
    });
    const activeTimer = started.activeTimer as {
      startedAt: string;
      workDate: string;
    };
    expect(activeTimer.workDate).toBe(
      getWorkDateInTimeZone(
        new Date(activeTimer.startedAt),
        "America/Los_Angeles",
      ),
    );

    const repeatedResponse = await timerPUT(
      startRequest(),
      timerContext(tree.childNodeId),
    );
    expect(await readJson(repeatedResponse)).toEqual({
      nodeId: tree.childNodeId,
      status: "already-running",
      activeTimer,
    });

    const storedTimer = await pool.query<{
      hourly_rate_cents: number | null;
    }>(
      `select hourly_rate_cents from active_timers
       where user_id = $1 and node_id = $2`,
      [tree.userId, tree.childNodeId],
    );
    expect(storedTimer.rows[0].hourly_rate_cents).toBe(12_500);
    expect(JSON.stringify(started)).not.toContain("hourly");

    const stoppedResponse = await timerDELETE(
      new Request(
        `http://localhost/api/agent/v1/nodes/${tree.childNodeId}/timer`,
        {
          method: "DELETE",
          headers: authorizationHeaders(tree.apiKey),
        },
      ),
      timerContext(tree.childNodeId),
    );
    expect(await readJson(stoppedResponse)).toEqual({
      nodeId: tree.childNodeId,
      status: "stopped",
    });
    const repeatedStop = await timerDELETE(
      new Request(
        `http://localhost/api/agent/v1/nodes/${tree.childNodeId}/timer`,
        {
          method: "DELETE",
          headers: authorizationHeaders(tree.apiKey),
        },
      ),
      timerContext(tree.childNodeId),
    );
    expect(await readJson(repeatedStop)).toEqual({
      nodeId: tree.childNodeId,
      status: "not-running",
    });

    const secondStart = await timerPUT(
      startRequest(),
      timerContext(tree.childNodeId),
    );
    expect(await readJson(secondStart)).toMatchObject({ status: "started" });
    const secondStop = await timerDELETE(
      new Request(
        `http://localhost/api/agent/v1/nodes/${tree.childNodeId}/timer`,
        {
          method: "DELETE",
          headers: authorizationHeaders(tree.apiKey),
        },
      ),
      timerContext(tree.childNodeId),
    );
    expect(await readJson(secondStop)).toMatchObject({ status: "stopped" });
    const entries = await pool.query<{ count: string }>(
      `select count(*) from time_entries
       where user_id = $1 and node_id = $2`,
      [tree.userId, tree.childNodeId],
    );
    expect(entries.rows[0].count).toBe("2");
  });

  it("uses indistinguishable scope failures and preserves lifecycle conflicts", async () => {
    const tree = await seedTree();
    const requestFor = (nodeId: string, timeZone = "UTC") =>
      new Request(`http://localhost/api/agent/v1/nodes/${nodeId}/timer`, {
        method: "PUT",
        headers: {
          ...authorizationHeaders(tree.apiKey),
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ timeZone }),
      });

    const outside = await timerPUT(
      requestFor(tree.siblingNodeId),
      timerContext(tree.siblingNodeId),
    );
    const missingId = randomUUID();
    const missing = await timerPUT(
      requestFor(missingId),
      timerContext(missingId),
    );
    expect(outside.status).toBe(404);
    expect(await readJson(outside)).toEqual(await readJson(missing));

    const completed = await timerPUT(
      requestFor(tree.completedNodeId),
      timerContext(tree.completedNodeId),
    );
    expect(completed.status).toBe(409);
    expect(await readJson(completed)).toMatchObject({
      code: "node-completed",
    });

    const invalidZone = await timerPUT(
      requestFor(tree.childNodeId, "Not/A_Zone"),
      timerContext(tree.childNodeId),
    );
    expect(invalidZone.status).toBe(400);
    expect(await readJson(invalidZone)).toMatchObject({
      code: "invalid-request",
      fields: { timeZone: ["Use a valid IANA time zone."] },
    });

    const fixedOffset = await timerPUT(
      requestFor(tree.childNodeId, "+08:00"),
      timerContext(tree.childNodeId),
    );
    expect(fixedOffset.status).toBe(400);
    expect(await readJson(fixedOffset)).toMatchObject({
      code: "invalid-request",
      fields: { timeZone: ["Use a valid IANA time zone."] },
    });
  });

  it("rejects a wrong secret before waiting on the public selector's owner lock", async () => {
    const tree = await seedTree();
    const lockClient = await pool.connect();
    await lockClient.query("begin");
    await lockClient.query(
      `select id from "user" where id = $1 for update`,
      [tree.userId],
    );
    const wrongKey = `ttk_v1.${tree.credentialId}.${randomBytes(32).toString("base64url")}`;
    const responsePromise = treeGET(
      new Request("http://localhost/api/agent/v1/tree", {
        headers: authorizationHeaders(wrongKey),
      }),
    );

    try {
      let timeout: ReturnType<typeof setTimeout> | undefined;
      const outcome = await Promise.race([
        responsePromise.then(() => "responded" as const),
        new Promise<"blocked">((resolve) => {
          timeout = setTimeout(() => resolve("blocked"), 1_000);
        }),
      ]);
      clearTimeout(timeout);
      expect(outcome).toBe("responded");
    } finally {
      await lockClient.query("rollback");
      lockClient.release();
    }

    const response = await responsePromise;
    expect(response.status).toBe(401);
    expect(await readJson(response)).toEqual({
      code: "invalid-key",
      message: "The agent API key is missing or invalid.",
    });
  });

  it("keeps an unrecordable timer active and returns the bounded timer error", async () => {
    const tree = await seedTree();
    await pool.query(
      `insert into active_timers
         (user_id, node_id, started_at, work_date)
       values ($1, $2, $3, '1900-01-01')`,
      [tree.userId, tree.childNodeId, new Date("1900-01-01T00:00:00.000Z")],
    );

    const response = await timerDELETE(
      new Request(
        `http://localhost/api/agent/v1/nodes/${tree.childNodeId}/timer`,
        {
          method: "DELETE",
          headers: authorizationHeaders(tree.apiKey),
        },
      ),
      timerContext(tree.childNodeId),
    );
    expect(response.status).toBe(409);
    expect(await readJson(response)).toEqual({
      code: "timer-too-long",
      message: "The active timer is too long to record.",
    });
    const remaining = await pool.query<{ count: string }>(
      `select count(*) from active_timers
       where user_id = $1 and node_id = $2`,
      [tree.userId, tree.childNodeId],
    );
    expect(remaining.rows[0].count).toBe("1");
  });

  it("rejects revoked keys and owners removed from the current allowlist", async () => {
    const tree = await seedTree();
    await revokeAgentApiKeyForUser(
      tree.userId,
      tree.rootNodeId,
      tree.credentialId,
    );
    const revoked = await treeGET(
      new Request("http://localhost/api/agent/v1/tree", {
        headers: authorizationHeaders(tree.apiKey),
      }),
    );
    expect(revoked.status).toBe(401);

    const replacement = await createAgentApiKeyForUser(
      tree.userId,
      tree.rootNodeId,
    );
    process.env.ALLOWED_EMAIL = "replacement@example.test";
    const disallowed = await treeGET(
      new Request("http://localhost/api/agent/v1/tree", {
        headers: authorizationHeaders(replacement.apiKey),
      }),
    );
    expect(disallowed.status).toBe(401);
    expect(await readJson(disallowed)).toEqual({
      code: "invalid-key",
      message: "The agent API key is missing or invalid.",
    });
  });
});
