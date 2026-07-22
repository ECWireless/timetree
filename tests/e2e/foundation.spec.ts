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
    userId,
    async cleanup() {
      await pool.query(`delete from "user" where id = $1`, [userId]);
    },
  };
}

async function seedHierarchy(userId: string, depth: number) {
  let parentId: string | null = null;

  for (let level = 1; level <= depth; level += 1) {
    const result: { rows: Array<{ id: string }> } = await pool.query(
      `insert into nodes (user_id, parent_id, position, title)
       values ($1, $2, 0, $3)
       returning id`,
      [userId, parentId, `Level ${level}`],
    );
    parentId = result.rows[0].id;
  }

  return parentId;
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
    await expect(page.getByRole("heading", { level: 1, name: "Node tree" })).toBeVisible();
    await expect(page.getByText("No nodes yet.")).toBeVisible();
    await expect(page.getByRole("button", { name: "New root node" })).toBeVisible();

    await page.getByRole("button", { name: "Sign out" }).click();

    await expect(page.getByTestId("sign-in-page")).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  } finally {
    await seeded.cleanup();
  }
});

test("builds and edits a URL-selected hierarchy", async ({ context, page, isMobile }) => {
  const seeded = await seedSession(allowedEmail, true);
  const pageErrors: Error[] = [];
  page.on("pageerror", (error) => pageErrors.push(error));

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

    await page.getByRole("button", { name: "New root node" }).click();
    await page.getByLabel("Root node title").press("Escape");
    await expect(page.getByLabel("Root node title")).toHaveCount(0);
    await page.getByRole("button", { name: "New root node" }).click();
    await page.getByLabel("Root node title").fill("Client work");
    await page.getByLabel("Root node title").press("Enter");
    await expect(page).toHaveURL(/\?node=[0-9a-f-]+$/);
    await expect(page.getByRole("heading", { level: 1, name: "Client work" })).toBeVisible();
    if (isMobile) {
      await expect(page.locator('[aria-label="Client work details"]')).toBeFocused();
    }

    await page.getByRole("button", { name: "Edit rate" }).click();
    await page.getByText("Set rate for this node", { exact: true }).click();
    await expect(page.getByRole("button", { name: "Save rate" })).toBeVisible();
    await page.waitForTimeout(300);
    await expect(page.getByRole("button", { name: "Save rate" })).toBeVisible();
    await page.getByLabel("Hourly rate in dollars").fill("125");
    await page.getByRole("button", { name: "Save rate" }).click();
    await expect(page.getByText("$125.00/hr · Set on this node")).toBeVisible();
    await page.emulateMedia({ forcedColors: "active" });
    await page.getByRole("button", { name: "Edit rate" }).click();
    const forcedColorsRate = page.getByLabel("Set rate for this node");
    await expect(forcedColorsRate).toBeChecked();
    await expect(forcedColorsRate).toHaveCSS("appearance", "auto");
    await forcedColorsRate.press("Escape");
    await page.emulateMedia({ forcedColors: "none" });
    await page.getByRole("button", { name: "Edit rate" }).click();
    await page.getByLabel("Hourly rate in dollars").fill("130");
    await page.getByLabel("Hourly rate in dollars").press("Escape");
    await expect(page.getByText("$125.00/hr · Set on this node")).toBeVisible();
    await page.getByRole("button", { name: "Edit rate" }).click();
    await page.getByLabel("Hourly rate in dollars").fill("125.50");
    await page.getByLabel("Hourly rate in dollars").press("Enter");
    await expect(page.getByText("$125.50/hr · Set on this node")).toBeVisible();

    await page.getByRole("button", { name: "Add child node" }).click();
    await page.getByLabel("Child node title for Client work").fill("Website");
    await page.getByLabel("Child node title for Client work").press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Website" })).toBeVisible();
    await expect(page.getByText("$125.50/hr · Inherited")).toBeVisible();
    const websiteUrl = page.url();

    await page.getByRole("button", { name: "Add child node" }).click();
    await page.getByLabel("Child node title for Website").fill("Research");
    await page.getByLabel("Child node title for Website").press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Research" })).toBeVisible();
    await expect(page.locator('.node-list > li[aria-level="3"]')).toHaveCount(1);

    await page.getByRole("button", { name: "Edit title" }).click();
    await page.getByLabel("Node title").fill("Discovery");
    await page.getByLabel("Node title").press("Enter");
    await expect(page.getByRole("heading", { level: 1, name: "Discovery" })).toBeVisible();

    await page.getByRole("button", { name: "Add description" }).click();
    await page.getByLabel("Description").fill("Early-stage research and interviews.");
    await page.getByLabel("Description").press("Enter");
    await expect(page.getByText("Early-stage research and interviews.")).toBeVisible();

    const discoveryUrl = page.url();
    await page.goBack();
    await expect(page).toHaveURL(websiteUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Website" })).toBeVisible();
    await page.goForward();
    await expect(page).toHaveURL(discoveryUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Discovery" })).toBeVisible();
    await page.reload();
    await expect(page).toHaveURL(discoveryUrl);
    await expect(page.getByRole("heading", { level: 1, name: "Discovery" })).toBeVisible();

    await page.goBack();
    await expect(page.getByRole("heading", { level: 1, name: "Website" })).toBeVisible();

    if (isMobile) {
      await page.getByRole("button", { name: "Back to tree" }).click();
      await expect(page).toHaveURL(/\/$/);
      await expect(page.getByRole("heading", { level: 1, name: "Node tree" })).toBeVisible();
      await expect(page.getByRole("button", { name: "Client work", exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: "Website", exact: true })).toBeFocused();
    } else {
      await page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("button", { name: "Client work", exact: true })
        .click();
      await expect(page.getByRole("heading", { level: 1, name: "Client work" })).toBeVisible();
      await page.setViewportSize({ width: 800, height: 900 });
      await expect(page.getByRole("button", { name: "Discovery", exact: true })).toBeVisible();
    }

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
    expect(pageErrors).toEqual([]);
  } finally {
    await seeded.cleanup();
  }
});

test("keeps deep inline child creation within a narrow desktop pane", async ({
  context,
  page,
  isMobile,
}) => {
  test.skip(isMobile, "The regression targets the narrow two-pane desktop layout.");
  const seeded = await seedSession(allowedEmail, true);

  try {
    const selectedNodeId = await seedHierarchy(seeded.userId, 7);
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
    await page.setViewportSize({ width: 800, height: 900 });
    await page.goto(`/?node=${selectedNodeId}`);

    await page.getByRole("button", { name: "Add child to Level 7" }).click();
    await expect(page.getByLabel("Child node title for Level 7")).toBeVisible();
    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth,
    );
    expect(hasHorizontalOverflow).toBe(false);
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
