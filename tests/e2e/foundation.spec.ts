import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import { Pool } from "pg";

const authSecret = "synthetic-auth-secret-for-browser-tests-only";
const allowedEmail = "browser-user@example.test";
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for browser tests.");
}

const pool = new Pool({ connectionString });

async function seedSession(email: string, emailVerified: boolean) {
  const userId = `browser-user-${randomUUID()}`;
  const token = `browser-token-${randomUUID()}`;

  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Browser User', $2, $3)`,
    [userId, email, emailVerified],
  );
  await pool.query(
    `insert into "session" (id, user_id, token, expires_at)
     values ($1, $2, $3, now() + interval '1 hour')`,
    [`browser-session-${randomUUID()}`, userId, token],
  );

  const signature = await makeSignature(token, authSecret);

  return {
    cookie: `${token}.${signature}`,
    async cleanup() {
      await pool.query(`delete from "user" where id = $1`, [userId]);
    },
  };
}

test.afterAll(async () => {
  await pool.end();
});

test("renders the signed-out foundation without page errors or overflow", async ({ page }) => {
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

  await page.goto("/");

  await expect(page).toHaveTitle("TimeTree");
  await expect(page.getByTestId("sign-in-page")).toBeVisible();
  await expect(page.getByText("Hierarchical time tracking")).toBeVisible();
  await expect(page.getByRole("heading", { level: 1, name: "See where your time goes." })).toBeVisible();
  await expect(
    page.getByText("Organize your work your way, then track time at any level."),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
  );

  expect(pageErrors).toEqual([]);
  expect(hasHorizontalOverflow).toBe(false);
});

test("distinguishes allowlist rejection from other OAuth errors", async ({ page }) => {
  await page.goto("/?error=access_denied");

  await expect(page.getByText("Google sign-in wasn’t completed. Please try again.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();

  await page.goto("/?error=ACCOUNT_NOT_ALLOWED");

  await expect(page.getByText("That Google account can’t access this TimeTree.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use another Google account" })).toBeVisible();

  await page.goto("/?error=account_not_allowed");

  await expect(page.getByText("That Google account can’t access this TimeTree.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Use another Google account" })).toBeVisible();
});

test("recovers when the Google sign-in request fails", async ({ page }) => {
  await page.route("**/api/auth/sign-in/social", (route) => route.abort("failed"));
  await page.goto("/");

  await page.getByRole("button", { name: "Continue with Google" }).click();

  await expect(page.locator("p[role='alert']")).toHaveText(
    "Google sign-in could not be started. Please try again.",
  );
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeEnabled();
});

test("loads the dashboard from a real Better Auth session and signs out", async ({ context, page }) => {
  const seeded = await seedSession(allowedEmail, true);

  try {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: seeded.cookie,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/");

    await expect(page.getByTestId("dashboard-page")).toBeVisible();
    await expect(page.getByRole("heading", { level: 1, name: "Your workspace is ready." })).toBeVisible();
    await expect(page.getByText(`Signed in as ${allowedEmail}`)).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByTestId("sign-in-page")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  } finally {
    await seeded.cleanup();
  }
});

test("recovers when sign-out fails", async ({ context, page }) => {
  const seeded = await seedSession(allowedEmail, true);

  try {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: seeded.cookie,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);
    await page.route("**/api/auth/sign-out", (route) => route.abort("failed"));
    await page.goto("/");

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.locator("p[role='alert']")).toHaveText("Sign out failed. Please try again.");
    await expect(page.getByRole("button", { name: "Sign out" })).toBeEnabled();
    await expect(page.getByTestId("dashboard-page")).toBeVisible();
  } finally {
    await seeded.cleanup();
  }
});

test("rejects a retained session for a different account", async ({ context, page }) => {
  const seeded = await seedSession("other-browser-user@example.test", true);

  try {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: seeded.cookie,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/");

    await expect(page.getByTestId("dashboard-page")).toHaveCount(0);
    await expect(page.getByText("That Google account can’t access this TimeTree.")).toBeVisible();
    await expect(page.getByRole("button", { name: "Use another Google account" })).toBeVisible();
  } finally {
    await seeded.cleanup();
  }
});

test("rejects a retained session with an unverified email", async ({ context, page }) => {
  const seeded = await seedSession(allowedEmail, false);

  try {
    await context.addCookies([
      {
        name: "better-auth.session_token",
        value: seeded.cookie,
        domain: "127.0.0.1",
        path: "/",
        httpOnly: true,
        sameSite: "Lax",
      },
    ]);

    await page.goto("/");

    await expect(page.getByTestId("dashboard-page")).toHaveCount(0);
    await expect(page.getByText("That Google account can’t access this TimeTree.")).toBeVisible();
  } finally {
    await seeded.cleanup();
  }
});
