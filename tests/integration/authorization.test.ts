import { randomUUID } from "node:crypto";

import { makeSignature } from "better-auth/crypto";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { Pool } from "pg";

import { AuthorizationError } from "../../src/lib/auth/policy";

const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for integration tests.");
}

const authSecret = "synthetic-auth-secret-for-integration-tests-only";
const allowedEmail = "allowed-user@example.test";
const pool = new Pool({ connectionString });
const userIds = new Set<string>();

let auth: typeof import("../../src/lib/server/auth").auth;
let requireAuthorizedSession: typeof import(
  "../../src/lib/server/authorization"
).requireAuthorizedSession;

async function seedSession(email: string, emailVerified: boolean) {
  const userId = `user-${randomUUID()}`;
  const sessionId = `session-${randomUUID()}`;
  const token = `token-${randomUUID()}`;
  userIds.add(userId);

  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic User', $2, $3)`,
    [userId, email, emailVerified],
  );
  await pool.query(
    `insert into "session" (id, user_id, token, expires_at)
     values ($1, $2, $3, now() + interval '1 hour')`,
    [sessionId, userId, token],
  );

  const signature = await makeSignature(token, authSecret);
  const headers = new Headers();
  headers.set("cookie", `better-auth.session_token=${token}.${signature}`);

  return { headers, token, userId };
}

describe("Better Auth single-account boundary", () => {
  beforeAll(async () => {
    vi.stubEnv("BETTER_AUTH_SECRET", authSecret);
    vi.stubEnv("BETTER_AUTH_URL", "http://localhost:3000");
    vi.stubEnv("GOOGLE_CLIENT_ID", "synthetic-google-client-id");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "synthetic-google-client-secret");
    vi.stubEnv("ALLOWED_EMAIL", allowedEmail);

    ({ auth } = await import("../../src/lib/server/auth"));
    ({ requireAuthorizedSession } = await import("../../src/lib/server/authorization"));
  });

  afterEach(async () => {
    process.env.ALLOWED_EMAIL = allowedEmail;

    if (userIds.size > 0) {
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

  it("accepts a real validated Better Auth session for the allowed account", async () => {
    const { headers } = await seedSession(allowedEmail, true);

    const session = await requireAuthorizedSession(headers);

    expect(session.user.email).toBe(allowedEmail);
    expect(session.user.emailVerified).toBe(true);
  });

  it("rejects a missing or invalid session", async () => {
    await expect(requireAuthorizedSession(new Headers())).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );

    const headers = new Headers({
      cookie: "better-auth.session_token=invalid-token.invalid-signature",
    });
    await expect(requireAuthorizedSession(headers)).rejects.toEqual(
      new AuthorizationError("missing-session"),
    );
  });

  it("rejects an unverified session email", async () => {
    const { headers } = await seedSession(allowedEmail, false);

    await expect(requireAuthorizedSession(headers)).rejects.toEqual(
      new AuthorizationError("unverified-email"),
    );
  });

  it("rejects a session for another account", async () => {
    const { headers } = await seedSession("other-user@example.test", true);

    await expect(requireAuthorizedSession(headers)).rejects.toEqual(
      new AuthorizationError("disallowed-email"),
    );
  });

  it("rejects a retained session after the current allowlist changes", async () => {
    const { headers } = await seedSession(allowedEmail, true);
    await expect(requireAuthorizedSession(headers)).resolves.toBeTruthy();

    process.env.ALLOWED_EMAIL = "replacement-user@example.test";

    await expect(requireAuthorizedSession(headers)).rejects.toEqual(
      new AuthorizationError("disallowed-email"),
    );
  });

  it("rejects disallowed identities before user or session creation", async () => {
    const context = await auth.$context;
    const userHook = context.options.databaseHooks?.user?.create?.before;
    const sessionHook = context.options.databaseHooks?.session?.create?.before;
    expect(userHook).toBeTypeOf("function");
    expect(sessionHook).toBeTypeOf("function");

    await expect(
      userHook?.(
        {
          id: `user-${randomUUID()}`,
          name: "Disallowed User",
          email: "other-user@example.test",
          emailVerified: true,
          image: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ),
    ).rejects.toThrow("account not allowed");

    const { userId } = await seedSession("other-user@example.test", true);
    await expect(
      sessionHook?.(
        {
          id: `session-${randomUUID()}`,
          token: `token-${randomUUID()}`,
          userId,
          expiresAt: new Date(Date.now() + 60_000),
          ipAddress: null,
          userAgent: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ),
    ).rejects.toThrow("account not allowed");
  });

  it("encrypts stored OAuth token material", async () => {
    const context = await auth.$context;
    expect(context.options.account?.encryptOAuthTokens).toBe(true);
  });

  it("discards OAuth ID tokens on account creation and update", async () => {
    const { userId } = await seedSession(allowedEmail, true);
    const context = await auth.$context;
    const account = await context.internalAdapter.createAccount({
      userId,
      providerId: "google",
      accountId: `google-${randomUUID()}`,
      idToken: "synthetic-id-token",
    });

    const created = await pool.query<{ id_token: string | null }>(
      `select id_token from account where id = $1`,
      [account.id],
    );
    expect(created.rows[0]?.id_token).toBeNull();

    await pool.query(`update account set id_token = 'synthetic-existing-id-token' where id = $1`, [
      account.id,
    ]);
    await context.internalAdapter.updateAccount(account.id, {
      idToken: "synthetic-replacement-id-token",
    });

    const updated = await pool.query<{ id_token: string | null }>(
      `select id_token from account where id = $1`,
      [account.id],
    );
    expect(updated.rows[0]?.id_token).toBeNull();
  });
});
