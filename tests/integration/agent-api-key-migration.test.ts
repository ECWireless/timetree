import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { afterAll, afterEach, describe, expect, it } from "vitest";
import { Pool, type PoolClient } from "pg";

import {
  generateAgentApiKey,
  parseAgentApiKey,
  verifyAgentApiKeySecret,
} from "../../src/lib/server/agent-api-key-token";

const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.",
  );
}

const pool = new Pool({ connectionString });
let client: PoolClient | null = null;
let schemaName: string | null = null;

async function applyMigration(fileName: string) {
  if (!client || !schemaName) {
    throw new Error("Migration test schema is not initialized.");
  }
  const source = await readFile(
    new URL(`../../drizzle/${fileName}`, import.meta.url),
    "utf8",
  );
  const schemaQualified = source.replaceAll(
    '"public".',
    `"${schemaName}".`,
  );
  for (const statement of schemaQualified.split("--> statement-breakpoint")) {
    if (statement.trim()) {
      await client.query(statement);
    }
  }
}

describe("agent API key migration compatibility", () => {
  afterEach(async () => {
    if (client) {
      const cleanupClient = client;
      const cleanupSchemaName = schemaName;
      client = null;
      schemaName = null;
      let cleanupError: unknown;
      try {
        await cleanupClient.query("reset search_path");
      } catch (error) {
        cleanupError = error;
      }
      try {
        if (cleanupSchemaName) {
          await cleanupClient.query(
            `drop schema if exists "${cleanupSchemaName}" cascade`,
          );
        }
      } catch (error) {
        cleanupError ??= error;
      } finally {
        cleanupClient.release();
      }
      if (cleanupError) {
        throw cleanupError;
      }
    }
  });

  afterAll(async () => {
    await pool.end();
  });

  it("backfills genuine v1 rows through 0003 without enabling v2 prefix downgrade", async () => {
    client = await pool.connect();
    schemaName = `agent_key_migration_${randomUUID().replaceAll("-", "")}`;
    await client.query(`create schema "${schemaName}"`);
    await client.query(`set search_path to "${schemaName}", public`);
    await applyMigration("0000_initial_schema.sql");
    await applyMigration("0001_hard_hercules.sql");
    await applyMigration("0002_normal_korg.sql");

    const userId = `migration-user-${randomUUID()}`;
    const rootNodeId = randomUUID();
    const legacyCredentialId = randomUUID();
    const legacySecretBytes = randomBytes(32);
    const legacyApiKey = `ttk_v1.${legacyCredentialId}.${legacySecretBytes.toString("base64url")}`;
    const legacyHash = createHash("sha256")
      .update(legacySecretBytes)
      .digest("hex");
    await client.query(
      `insert into "user" (id, name, email, email_verified)
       values ($1, 'Synthetic Migration User', $2, true)`,
      [userId, `${userId}@example.test`],
    );
    await client.query(
      `insert into nodes (id, user_id, position, title)
       values ($1, $2, 0, 'Legacy root')`,
      [rootNodeId, userId],
    );
    await client.query(
      `insert into agent_api_keys
         (id, user_id, root_node_id, secret_hash)
       values ($1, $2, $3, $4)`,
      [legacyCredentialId, userId, rootNodeId, legacyHash],
    );

    await applyMigration("0003_old_molly_hayes.sql");

    const migrated = await client.query<{
      access_level: string;
      id: string;
      label: string;
      secret_hash: string;
    }>(
      `select id, label, access_level, secret_hash
       from agent_api_keys
       where id = $1`,
      [legacyCredentialId],
    );
    expect(migrated.rows).toEqual([
      {
        id: legacyCredentialId,
        label: "Existing key",
        access_level: "read_write",
        secret_hash: legacyHash,
      },
    ]);
    const parsedLegacy = parseAgentApiKey(legacyApiKey);
    expect(parsedLegacy).toMatchObject({
      version: "v1",
      credentialId: legacyCredentialId,
    });
    expect(
      parsedLegacy &&
        migrated.rows[0].access_level === "read_write" &&
        verifyAgentApiKeySecret(
          parsedLegacy.version,
          parsedLegacy.secretBytes,
          migrated.rows[0].secret_hash,
        ),
    ).toBe(true);

    const generatedV2 = generateAgentApiKey();
    await client.query(
      `insert into agent_api_keys
         (id, user_id, root_node_id, label, access_level, secret_hash)
       values ($1, $2, $3, 'New client', 'read_only', $4)`,
      [
        generatedV2.credentialId,
        userId,
        rootNodeId,
        generatedV2.secretHash,
      ],
    );
    const parsedV2 = parseAgentApiKey(generatedV2.apiKey);
    const downgraded = parseAgentApiKey(
      generatedV2.apiKey.replace("ttk_v2.", "ttk_v1."),
    );
    expect(
      parsedV2 &&
        verifyAgentApiKeySecret(
          parsedV2.version,
          parsedV2.secretBytes,
          generatedV2.secretHash,
        ),
    ).toBe(true);
    expect(
      downgraded &&
        verifyAgentApiKeySecret(
          downgraded.version,
          downgraded.secretBytes,
          generatedV2.secretHash,
        ),
    ).toBe(false);
  });
});
