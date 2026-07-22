import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import { Pool } from "pg";

const authSecret = "synthetic-auth-secret-for-browser-tests-only";
const allowedEmail = "browser-user@example.test";
const connectionString = process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error("DATABASE_URL or DATABASE_URL_UNPOOLED is required for browser tests.");
}

const pool = new Pool({ connectionString });

async function expectCenteredDialog(page: Page, dialog: Locator) {
  await expect(dialog).toHaveCSS("animation-name", "dialog-enter");
  await page.waitForTimeout(200);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  // Native-dialog and mobile viewport rounding can differ by a handful of CSS pixels.
  expect(Math.abs(box!.x + box!.width / 2 - viewport!.width / 2)).toBeLessThan(8);
  expect(Math.abs(box!.y + box!.height / 2 - viewport!.height / 2)).toBeLessThan(8);
}

async function dragNodeTo(
  page: Page,
  sourceName: string,
  targetName: string,
  zone: "before" | "inside" | "after",
) {
  const sourceRow = page.getByRole("button", { name: sourceName, exact: true }).locator("..");
  const targetRow = page.getByRole("button", { name: targetName, exact: true }).locator("..");
  const handle = sourceRow.locator(".node-drag-handle");
  await expect(handle).toBeVisible();
  await expect(handle).toHaveCSS("touch-action", "none");
  const handleBox = await handle.boundingBox();
  const targetBox = await targetRow.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  const startX = handleBox!.x + handleBox!.width / 2;
  const startY = handleBox!.y + handleBox!.height / 2;
  const targetYRatio = zone === "before" ? 0.1 : zone === "after" ? 0.9 : 0.5;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 8, { steps: 3 });
  await page.mouse.move(
    targetBox!.x + Math.min(targetBox!.width / 2, 120),
    targetBox!.y + targetBox!.height * targetYRatio,
    { steps: 12 },
  );
  await page.waitForTimeout(100);
  await page.mouse.up();
}

async function touchDragNodeTo(
  page: Page,
  sourceName: string,
  targetName: string,
  zone: "before" | "inside" | "after",
) {
  const sourceRow = page.getByRole("button", { name: sourceName, exact: true }).locator("..");
  const targetRow = page.getByRole("button", { name: targetName, exact: true }).locator("..");
  const handle = sourceRow.locator(".node-drag-handle");
  const handleBox = await handle.boundingBox();
  const targetBox = await targetRow.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(targetBox).not.toBeNull();
  await page.evaluate(() => {
    document.addEventListener(
      "pointerdown",
      (event) => {
        document.documentElement.dataset.lastDragPointerType = event.pointerType;
      },
      { capture: true, once: true },
    );
  });
  const session = await page.context().newCDPSession(page);
  const start = {
    x: handleBox!.x + handleBox!.width / 2,
    y: handleBox!.y + handleBox!.height / 2,
  };
  const targetYRatio = zone === "before" ? 0.1 : zone === "after" ? 0.9 : 0.5;
  const end = {
    x: targetBox!.x + Math.min(targetBox!.width / 2, 120),
    y: targetBox!.y + targetBox!.height * targetYRatio,
  };

  await session.send("Input.dispatchTouchEvent", {
    type: "touchStart",
    touchPoints: [{ ...start, id: 1, radiusX: 1, radiusY: 1, force: 1 }],
  });
  for (let step = 1; step <= 16; step += 1) {
    const progress = step / 16;
    await session.send("Input.dispatchTouchEvent", {
      type: "touchMove",
      touchPoints: [
        {
          x: start.x + (end.x - start.x) * progress,
          y: start.y + (end.y - start.y) * progress,
          id: 1,
          radiusX: 1,
          radiusY: 1,
          force: 1,
        },
      ],
    });
  }
  await page.waitForTimeout(100);
  await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  await session.detach();
  await expect
    .poll(() => page.evaluate(() => document.documentElement.dataset.lastDragPointerType))
    .toBe("touch");
}

async function dragNodeWithAutoScroll(page: Page, sourceName: string, targetName: string) {
  const pane = page.locator(".tree-pane");
  const sourceRow = page.getByRole("button", { name: sourceName, exact: true }).locator("..");
  const targetRow = page.getByRole("button", { name: targetName, exact: true }).locator("..");
  const handle = sourceRow.locator(".node-drag-handle");
  const handleBox = await handle.boundingBox();
  const paneBox = await pane.boundingBox();
  expect(handleBox).not.toBeNull();
  expect(paneBox).not.toBeNull();
  const startX = handleBox!.x + handleBox!.width / 2;
  const startY = handleBox!.y + handleBox!.height / 2;

  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + 8, startY + 8, { steps: 3 });
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await page.mouse.move(paneBox!.x + paneBox!.width / 2, paneBox!.y + paneBox!.height - 8);
    await page.waitForTimeout(75);
    const candidateBox = await targetRow.boundingBox();
    if (
      candidateBox &&
      candidateBox.y >= paneBox!.y &&
      candidateBox.y + candidateBox.height <= paneBox!.y + paneBox!.height
    ) {
      break;
    }
  }
  await expect.poll(() => pane.evaluate((element) => element.scrollTop)).toBeGreaterThan(0);
  await expect
    .poll(async () => {
      const candidateBox = await targetRow.boundingBox();
      return Boolean(
        candidateBox &&
          candidateBox.y >= paneBox!.y &&
          candidateBox.y + candidateBox.height <= paneBox!.y + paneBox!.height,
      );
    })
    .toBe(true);
  const targetBox = await targetRow.boundingBox();
  expect(targetBox).not.toBeNull();
  await page.mouse.move(
    targetBox!.x + Math.min(targetBox!.width / 2, 120),
    targetBox!.y + targetBox!.height / 2,
    { steps: 8 },
  );
  await page.waitForTimeout(100);
  await page.mouse.up();
}

async function expectRootOrder(page: Page, names: string[]) {
  await expect
    .poll(() =>
      page.locator('.node-list > li[aria-level="1"] > .node-row .node-select').evaluateAll(
        (buttons) => buttons.map((button) => button.getAttribute("aria-label")),
      ),
    )
    .toEqual(names);
}

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
      await pool.query(`delete from active_timers where user_id = $1`, [userId]);
      await pool.query(`delete from time_entries where user_id = $1`, [userId]);
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

async function insertNode(
  userId: string,
  title: string,
  position: number,
  parentId: string | null = null,
  completed = false,
) {
  const result = await pool.query<{ id: string }>(
    `insert into nodes (user_id, parent_id, position, title, completed_at)
     values ($1, $2, $3, $4, $5)
     returning id`,
    [userId, parentId, position, title, completed ? new Date("2026-07-22T00:00:00Z") : null],
  );
  return result.rows[0].id;
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
    await page.getByLabel("Node title", { exact: true }).fill("Discovery");
    await page.getByLabel("Node title", { exact: true }).press("Enter");
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

    await page
      .getByRole("navigation", { name: "Breadcrumb" })
      .getByRole("button", { name: "Website", exact: true })
      .click();
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

test("changes historical rollups when completed nodes are shown", async ({ context, page }) => {
  const seeded = await seedSession(allowedEmail, true);

  try {
    const rootId = await insertNode(seeded.userId, "Rollup root", 0);
    const activeChildId = await insertNode(seeded.userId, "Active work", 0, rootId);
    const completedChildId = await insertNode(
      seeded.userId,
      "Completed work",
      1,
      rootId,
      true,
    );
    const completedGrandchildId = await insertNode(
      seeded.userId,
      "Completed detail",
      0,
      completedChildId,
      true,
    );
    await pool.query(
      `insert into time_entries
         (user_id, node_id, work_date, duration_seconds, hourly_rate_cents)
       values
         ($1, $2, '2026-07-22', 3600, 10000),
         ($1, $3, '2026-07-22', 1800, 20000),
         ($1, $4, '2026-07-22', 900, null),
         ($1, $5, '2026-07-22', 600, 30000)`,
      [seeded.userId, rootId, activeChildId, completedChildId, completedGrandchildId],
    );
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

    const rootButton = page.getByRole("button", { name: "Rollup root", exact: true });
    const compactMetrics = rootButton.locator(".node-metrics");
    await expect(compactMetrics).toHaveAttribute(
      "aria-label",
      "Time totals: 1h 30m rolled up, $200.00 historical value",
    );
    await expect(compactMetrics.locator(".node-metrics__warning")).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Completed work, completed", exact: true }),
    ).toHaveCount(0);

    await page.getByRole("button", { name: "Show completed" }).click();
    await expect(compactMetrics).toHaveAttribute(
      "aria-label",
      "Time totals: 1h 55m rolled up, $250.00 historical value, contains entries with hourly rates and entries without hourly rates",
    );
    await expect(compactMetrics.locator(".node-metrics__warning")).toHaveCount(1);
    await page.getByRole("button", { name: "Expand Rollup root" }).click();
    await expect(
      page.getByRole("button", { name: "Completed work, completed", exact: true }),
    ).toBeVisible();

    await rootButton.click();
    const detailMetrics = page.locator(".detail-content > .node-metrics");
    await expect(detailMetrics).toHaveAttribute(
      "aria-label",
      "Time totals: 1h 55m rolled up, 1h direct, $250.00 historical value, contains entries with hourly rates and entries without hourly rates",
    );
    await page.getByRole("button", { name: "Show completed" }).click();
    await expect(detailMetrics).toHaveAttribute(
      "aria-label",
      "Time totals: 1h 30m rolled up, 1h direct, $200.00 historical value",
    );
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

test("searches, moves, completes, reopens, and deletes nodes", async ({
  context,
  page,
  isMobile,
}) => {
  const seeded = await seedSession(allowedEmail, true);

  try {
    for (let position = 0; position < 20; position += 1) {
      await insertNode(seeded.userId, `Filler ${position + 1}`, position);
    }
    const sourceRootId = await insertNode(seeded.userId, "Client Alpha", 20);
    const sourceId = await insertNode(seeded.userId, "Shared work", 0, sourceRootId);
    await insertNode(seeded.userId, "Sibling project", 1, sourceRootId);
    const destinationId = await insertNode(seeded.userId, "Destination", 21);
    await insertNode(seeded.userId, "Shared work", 0, destinationId);
    await insertNode(seeded.userId, "Old client", 22, null, true);
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

    await expect(page.getByRole("button", { name: "Old client", exact: true })).toHaveCount(0);
    await page.getByLabel("Search node titles").fill("shared");
    const searchResults = page.locator("#tree-search-results");
    await expect(searchResults.getByRole("button")).toHaveCount(2);
    await expect(searchResults).toContainText("Client Alpha / Shared work");
    await expect(searchResults).toContainText("Destination / Shared work");
    await searchResults.getByRole("button").filter({ hasText: "Client Alpha" }).click();
    await expect(page).toHaveURL(new RegExp(`node=${sourceId}`));
    await expect(page.getByRole("heading", { level: 1, name: "Shared work" })).toBeVisible();
    const targetTreeButton = page.getByRole("button", { name: "Shared work", exact: true });
    if (isMobile) {
      await page.getByRole("button", { name: "Back to tree" }).click();
      await expect(targetTreeButton).toBeVisible();
      await expect(targetTreeButton).toBeFocused();
      await targetTreeButton.click();
    } else {
      await expect(targetTreeButton).toBeVisible();
      const targetBox = await targetTreeButton.boundingBox();
      const viewport = page.viewportSize();
      expect(targetBox).not.toBeNull();
      expect(viewport).not.toBeNull();
      expect(targetBox!.y).toBeGreaterThanOrEqual(0);
      expect(targetBox!.y + targetBox!.height).toBeLessThanOrEqual(viewport!.height);
    }

    await page.getByRole("button", { name: "Move To…" }).click();
    const moveDialog = page.getByRole("dialog", { name: /Choose a new parent/ });
    await expectCenteredDialog(page, moveDialog);
    await expect(moveDialog.getByLabel("Search destinations")).toBeFocused();
    await expect(moveDialog.locator(".move-browser__toolbar")).toContainText("Client Alpha");
    await expect(
      moveDialog.locator(".move-browser__nodes").getByRole("button", {
        name: /Sibling project/,
      }),
    ).toBeVisible();
    await moveDialog.getByRole("button", { name: "Up one level" }).click();
    await expect(moveDialog.locator(".move-browser__toolbar")).toContainText("Root");
    await expect(moveDialog.getByRole("button", { name: "Move here" })).toBeFocused();
    const destinationBrowserButton = moveDialog
      .locator(".move-browser__nodes")
      .getByRole("button", { name: /Destination/ });
    await destinationBrowserButton.focus();
    await destinationBrowserButton.press("Enter");
    await expect(moveDialog.locator(".move-browser__toolbar")).toContainText("Destination");
    await expect(moveDialog.getByRole("button", { name: "Move here" })).toBeFocused();
    await moveDialog.getByLabel("Search destinations").fill("Client Alpha");
    await expect(moveDialog.locator('[aria-label="Search move destinations"]')).toContainText(
      "Client Alpha",
    );
    await moveDialog.getByLabel("Search destinations").fill("");
    await moveDialog.getByRole("button", { name: "Move here" }).click();
    const breadcrumb = page.getByRole("navigation", { name: "Breadcrumb" });
    await expect(breadcrumb.getByRole("button", { name: "Destination" })).toBeVisible();
    await expect(breadcrumb.getByText("Shared work", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Complete node" }).click();
    await expect(page.locator(".status-pill")).toHaveText("Completed");
    await expect(page.getByRole("button", { name: "Show completed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    if (isMobile) {
      await page.getByRole("button", { name: "Back to tree" }).click();
      const completedTreeButton = page.getByRole("button", {
        name: "Shared work, completed",
      });
      await expect(completedTreeButton).toBeFocused();
      await completedTreeButton.click();
    }
    await page.getByRole("button", { name: "Reopen node" }).click();
    await expect(page.locator(".status-pill")).toHaveText("Active");

    const deleteTrigger = page.getByRole("button", { name: "Delete node" });
    await deleteTrigger.click();
    const deleteDialog = page.getByRole("dialog", { name: /Permanently delete/ });
    await expectCenteredDialog(page, deleteDialog);
    await expect(deleteDialog.locator(".dialog-copy")).toHaveText(
      "This removes the node and every descendant. Deletion is blocked only when this subtree contains a time entry or a running timer.",
    );
    await deleteDialog.press("Escape");
    await expect(deleteTrigger).toBeFocused();
    await deleteTrigger.click();
    await page.getByRole("button", { name: "Delete permanently" }).click();
    await expect(page).not.toHaveURL(new RegExp(`node=${sourceId}`));
    await expect(page.getByRole("heading", { level: 1, name: "Shared work" })).toHaveCount(0);

    await page.getByLabel("Search node titles").fill("Old client");
    await page.locator("#tree-search-results").getByRole("button").click();
    await expect(page.getByRole("button", { name: "Show completed" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("heading", { level: 1, name: "Old client" })).toBeVisible();
    await page.getByRole("button", { name: "Show completed" }).click();
    await page.getByRole("button", { name: "Reopen node" }).click();
    await expect(page.getByRole("button", { name: "Show completed" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    await expect(page.locator(".status-pill")).toHaveText("Active");
  } finally {
    await seeded.cleanup();
  }
});

test("drags nodes before, after, and inside with Move To parity", async ({
  context,
  page,
  isMobile,
}) => {
  const seeded = await seedSession(allowedEmail, true);

  try {
    const alphaId = await insertNode(seeded.userId, "Drag Alpha", 0);
    const betaId = await insertNode(seeded.userId, "Drag Beta", 1);
    const destinationId = await insertNode(seeded.userId, "Drag Destination", 2);
    const dialogSourceId = await insertNode(seeded.userId, "Dialog Source", 3);
    const existingChildId = await insertNode(
      seeded.userId,
      "Existing destination child",
      0,
      destinationId,
    );
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

    if (isMobile) {
      await touchDragNodeTo(page, "Drag Beta", "Drag Alpha", "before");
    } else {
      await dragNodeTo(page, "Drag Beta", "Drag Alpha", "before");
    }
    await expectRootOrder(page, [
      "Drag Beta",
      "Drag Alpha",
      "Drag Destination",
      "Dialog Source",
    ]);

    await dragNodeTo(page, "Drag Beta", "Drag Destination", "after");
    await expectRootOrder(page, [
      "Drag Alpha",
      "Drag Destination",
      "Drag Beta",
      "Dialog Source",
    ]);

    await dragNodeTo(page, "Drag Beta", "Drag Destination", "inside");
    await expect(page.getByRole("button", { name: "Drag Beta", exact: true })).toBeVisible();
    await expect(page.locator('.node-list > li[aria-level="2"]')).toHaveCount(2);

    await page.getByRole("button", { name: "Dialog Source", exact: true }).click();
    await page.getByRole("button", { name: "Move To…" }).click();
    const moveDialog = page.getByRole("dialog", { name: /Choose a new parent/ });
    await moveDialog
      .locator(".move-browser__nodes")
      .getByRole("button", { name: /Drag Destination/ })
      .click();
    await expect(moveDialog.locator(".move-browser__toolbar")).toContainText("Drag Destination");
    await expect(moveDialog.getByRole("button", { name: "Move here" })).toBeFocused();
    await moveDialog.getByRole("button", { name: "Move here" }).click();
    await expect(
      page
        .getByRole("navigation", { name: "Breadcrumb" })
        .getByRole("button", { name: "Drag Destination" }),
    ).toBeVisible();

    const persisted = await pool.query<{ id: string; parent_id: string | null; position: number }>(
      `select id, parent_id, position
       from nodes
       where id = any($1::uuid[])
       order by parent_id nulls first, position`,
      [[alphaId, betaId, destinationId, dialogSourceId, existingChildId]],
    );
    expect(persisted.rows).toEqual([
      { id: alphaId, parent_id: null, position: 0 },
      { id: destinationId, parent_id: null, position: 1 },
      { id: existingChildId, parent_id: destinationId, position: 0 },
      { id: betaId, parent_id: destinationId, position: 1 },
      { id: dialogSourceId, parent_id: destinationId, position: 2 },
    ]);
  } finally {
    await seeded.cleanup();
  }
});

test("expands a collapsed branch after a two-pulse drag hover", async ({
  context,
  page,
}) => {
  const seeded = await seedSession(allowedEmail, true);

  try {
    const sourceId = await insertNode(seeded.userId, "Hover Source", 0);
    const parentId = await insertNode(seeded.userId, "Collapsed Parent", 1);
    const childId = await insertNode(seeded.userId, "Revealed Child", 0, parentId);
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

    const sourceHandle = page
      .getByRole("button", { name: "Hover Source", exact: true })
      .locator("..")
      .locator(".node-drag-handle");
    const parentRow = page
      .getByRole("button", { name: "Collapsed Parent", exact: true })
      .locator("..");
    const sourceBox = await sourceHandle.boundingBox();
    const parentBox = await parentRow.boundingBox();
    expect(sourceBox).not.toBeNull();
    expect(parentBox).not.toBeNull();
    await page.mouse.move(
      sourceBox!.x + sourceBox!.width / 2,
      sourceBox!.y + sourceBox!.height / 2,
    );
    await page.mouse.down();
    await page.mouse.move(sourceBox!.x + sourceBox!.width / 2 + 8, sourceBox!.y + 8, {
      steps: 3,
    });
    await page.mouse.move(
      parentBox!.x + Math.min(parentBox!.width / 2, 120),
      parentBox!.y + parentBox!.height / 2,
      { steps: 10 },
    );

    await expect(parentRow).toHaveClass(/node-row--drag-expand-pending/);
    await expect(parentRow).toHaveCSS("animation-name", "drag-expand-blink");
    await expect(parentRow).toHaveCSS("animation-delay", /0\.5s|500ms/);
    await expect(parentRow).toHaveCSS("animation-iteration-count", "2");
    await expect(page.getByRole("button", { name: "Collapse Collapsed Parent" })).toBeVisible({
      timeout: 2_000,
    });
    const childRow = page.getByRole("button", { name: "Revealed Child", exact: true }).locator("..");
    const childBox = await childRow.boundingBox();
    expect(childBox).not.toBeNull();
    await page.mouse.move(
      childBox!.x + Math.min(childBox!.width / 2, 120),
      childBox!.y + childBox!.height / 2,
      { steps: 8 },
    );
    await page.waitForTimeout(100);
    await page.mouse.up();

    await expect(page.getByRole("button", { name: "Collapse Revealed Child" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Hover Source", exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const result = await pool.query<{ parent_id: string | null; position: number }>(
          `select parent_id, position from nodes where id = $1`,
          [sourceId],
        );
        return result.rows[0];
      })
      .toEqual({ parent_id: childId, position: 0 });
  } finally {
    await seeded.cleanup();
  }
});

test("autoscrolls an overflowing tree while dragging", async ({
  context,
  page,
  isMobile,
}) => {
  test.skip(isMobile, "Desktop uses the independently scrolling tree pane.");
  const seeded = await seedSession(allowedEmail, true);

  try {
    const sourceId = await insertNode(seeded.userId, "Scroll Source", 0);
    for (let position = 1; position <= 28; position += 1) {
      await insertNode(seeded.userId, `Scroll filler ${position}`, position);
    }
    const targetId = await insertNode(seeded.userId, "Scroll Target", 29);
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

    const paneBox = await page.locator(".tree-pane").boundingBox();
    const targetBox = await page
      .getByRole("button", { name: "Scroll Target", exact: true })
      .locator("..")
      .boundingBox();
    expect(paneBox).not.toBeNull();
    expect(targetBox).not.toBeNull();
    expect(targetBox!.y).toBeGreaterThanOrEqual(paneBox!.y + paneBox!.height);
    await dragNodeWithAutoScroll(page, "Scroll Source", "Scroll Target");
    await expect(page.getByRole("button", { name: "Collapse Scroll Target" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Scroll Source", exact: true })).toBeVisible();
    await expect
      .poll(async () => {
        const result = await pool.query<{ parent_id: string | null; position: number }>(
          `select parent_id, position from nodes where id = $1`,
          [sourceId],
        );
        return result.rows[0];
      })
      .toEqual({ parent_id: targetId, position: 0 });
  } finally {
    await seeded.cleanup();
  }
});

test("identifies every running timer that blocks recursive completion", async ({
  context,
  page,
}) => {
  const seeded = await seedSession(allowedEmail, true);

  try {
    const rootId = await insertNode(seeded.userId, "Timed project", 0);
    const childId = await insertNode(seeded.userId, "Running child", 0, rootId);
    await pool.query(
      `insert into active_timers (user_id, node_id, started_at, work_date)
       values
         ($1, $2, now(), '2026-07-22'),
         ($1, $3, now(), '2026-07-22')`,
      [seeded.userId, rootId, childId],
    );
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
    await page.goto(`/?node=${rootId}`);

    await page.getByRole("button", { name: "Complete node" }).click();

    const completionAlert = page.locator('.detail-error[role="alert"]');
    await expect(completionAlert).toContainText(
      "Stop the running timers in this subtree first.",
    );
    await expect(completionAlert).toContainText("Running: Timed project;");
    await expect(completionAlert).toContainText("Timed project / Running child");
    await expect(page.locator(".status-pill")).toHaveText("Active");
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
