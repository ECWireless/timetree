import { randomUUID } from "node:crypto";

import { expect, test, type Locator, type Page } from "@playwright/test";
import { makeSignature } from "better-auth/crypto";
import { Pool } from "pg";

const authSecret = "synthetic-auth-secret-for-browser-tests-only";
const allowedEmail = "browser-user@example.test";
const connectionString =
  process.env.DATABASE_URL_UNPOOLED || process.env.DATABASE_URL;

if (!connectionString) {
  throw new Error(
    "DATABASE_URL or DATABASE_URL_UNPOOLED is required for browser tests.",
  );
}

const pool = new Pool({ connectionString });

test.use({ screenshot: "off", trace: "off", video: "off" });

async function expectCenteredDialog(page: Page, dialog: Locator) {
  await expect(dialog).toHaveCSS("animation-name", "dialog-enter");
  await page.waitForTimeout(200);
  const box = await dialog.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(Math.abs(box!.x + box!.width / 2 - viewport!.width / 2)).toBeLessThan(
    8,
  );
  expect(
    Math.abs(box!.y + box!.height / 2 - viewport!.height / 2),
  ).toBeLessThan(8);
}

async function expectHorizontalIconButton(button: Locator) {
  const layout = await button.evaluate((element) => {
    const style = window.getComputedStyle(element);
    return {
      alignItems: style.alignItems,
      display: style.display,
      flexDirection: style.flexDirection,
    };
  });
  expect(["flex", "inline-flex"]).toContain(layout.display);
  expect(layout.alignItems).toBe("center");
  expect(layout.flexDirection).toBe("row");
}

async function seedAgentAccessNode(title = "Synthetic agent scope") {
  const userId = `agent-browser-user-${randomUUID()}`;
  const token = `agent-browser-token-${randomUUID()}`;

  await pool.query(
    `insert into "user" (id, name, email, email_verified)
     values ($1, 'Synthetic Agent Browser User', $2, true)`,
    [userId, allowedEmail],
  );
  await pool.query(
    `insert into "session" (id, user_id, token, expires_at)
     values ($1, $2, $3, now() + interval '1 hour')`,
    [`agent-browser-session-${randomUUID()}`, userId, token],
  );
  const node = await pool.query<{ id: string }>(
    `insert into nodes (user_id, position, title)
     values ($1, 0, $2)
     returning id`,
    [userId, title],
  );
  const signature = await makeSignature(token, authSecret);

  return {
    cookie: `${token}.${signature}`,
    nodeId: node.rows[0].id,
    userId,
    async cleanup() {
      await pool.query(`delete from "user" where id = $1`, [userId]);
    },
  };
}

test.afterAll(async () => {
  await pool.end();
});

test.afterEach(async ({ context }) => {
  for (const activePage of context.pages()) {
    await activePage
      .locator(".agent-secret__value code")
      .evaluateAll((elements) => {
        for (const element of elements) {
          element.textContent = "TIMETREE_API_KEY=[redacted]";
        }
      })
      .catch(() => undefined);
  }
});

test("creates, rotates, and revokes scoped agent access", async ({
  context,
  page,
}) => {
  const seeded = await seedAgentAccessNode();

  try {
    await context.grantPermissions(
      ["clipboard-read", "clipboard-write"],
      { origin: "http://127.0.0.1:3187" },
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
    await page.goto(`/?node=${seeded.nodeId}`);

    const setupTrigger = page.getByRole("button", {
      name: "Set up agent access",
    });
    await setupTrigger.click();
    const dialog = page.getByRole("dialog", {
      name: "Agent access for Synthetic agent scope",
    });
    await expectCenteredDialog(page, dialog);
    await expect(
      dialog.getByText("Once per Codex installation"),
    ).toBeVisible();
    await expect(dialog.getByText("Once per repository")).toBeVisible();
    await expect(dialog.getByText(/Calendar time zone:/)).toBeVisible();

    const setupCopyButton = dialog.getByRole("button", {
      name: "Copy Codex setup prompt",
    });
    await expectHorizontalIconButton(setupCopyButton);
    await setupCopyButton.click();
    const setupPrompt = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(setupPrompt).toContain("Install this deployment's TimeTree skill");
    expect(setupPrompt).toContain(
      "http://127.0.0.1:3187/api/agent/v1/tree",
    );
    expect(setupPrompt).not.toContain("ttk_v1.");
    expect(setupPrompt).not.toContain(seeded.nodeId);
    await expect(
      dialog.getByText(
        "Codex setup prompt copied. Paste it into any Codex session on the installation you want to configure.",
      ),
    ).toBeVisible();
    await expect(dialog.getByText("Acknowledged here")).toHaveCount(0);
    expect(
      await page.evaluate(() =>
        Object.keys(window.localStorage).filter((key) =>
          key.startsWith("timetree:codex:"),
        ),
      ),
    ).toHaveLength(0);

    await dialog.getByText("Manual setup and generated files").click();
    await expect(
      dialog.getByText(
        "~/.agents/skills/timetree-timekeeping/SKILL.md",
        { exact: false },
      ),
    ).toBeVisible();

    await dialog.getByRole("button", { name: "Create API key" }).click();
    const closeButton = dialog.getByRole("button", {
      name: "Close agent access dialog",
    });
    await expect(closeButton).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Copy .env line" }),
    ).toBeFocused();
    await expect(
      dialog.getByText(/Add this exact line to the repository-root/),
    ).toBeVisible();
    const credentialValue = dialog.locator(".agent-secret__value code");
    const firstCredentialLine = await credentialValue.textContent();
    expect(
      /^TIMETREE_API_KEY=ttk_v1\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/.test(
        firstCredentialLine ?? "",
      ),
    ).toBe(true);

    await dialog.getByRole("button", { name: "Copy .env line" }).click();
    expect(
      (await page.evaluate(() => navigator.clipboard.readText())) ===
        firstCredentialLine,
    ).toBe(true);
    const firstStoredCredential = await pool.query<{
      id: string;
      secret_hash: string;
    }>(
      `select id, secret_hash
       from agent_api_keys
       where user_id = $1 and root_node_id = $2`,
      [seeded.userId, seeded.nodeId],
    );
    expect(firstStoredCredential.rows).toHaveLength(1);
    expect(firstStoredCredential.rows[0].secret_hash).toMatch(/^[0-9a-f]{64}$/);

    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();
    await expect(dialog.locator(".agent-secret__value")).toHaveCount(0);
    await expect(closeButton).toBeEnabled();
    const verificationButton = dialog.getByRole("button", {
      name: "Copy connection verification prompt",
    });
    await expect(verificationButton).toBeFocused();
    await verificationButton.click();
    const verificationPrompt = await page.evaluate(() =>
      navigator.clipboard.readText(),
    );
    expect(verificationPrompt).toContain("without mutating TimeTree");
    expect(verificationPrompt).not.toContain("ttk_v1.");
    expect(verificationPrompt).not.toContain(seeded.nodeId);
    await dialog
      .getByText("Manual connection verification prompt")
      .click();
    await expect(
      dialog.locator(".agent-credential .agent-setup-fallback code"),
    ).toContainText("without mutating TimeTree");
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new DOMException("Denied")),
      });
    });
    await verificationButton.click();
    await expect(
      dialog.getByText("Copy failed. Select the verification prompt below."),
    ).toBeVisible();

    await closeButton.click();
    const manageTrigger = page.getByRole("button", {
      name: "Manage agent access",
    });
    await expect(manageTrigger).toBeFocused();
    await manageTrigger.click();
    await expect(dialog.getByText("Active", { exact: true })).toBeVisible();
    await expect(dialog.locator(".agent-secret__value")).toHaveCount(0);

    const rotateButton = dialog.getByRole("button", {
      name: "Rotate API key",
    });
    await rotateButton.click();
    await expect(dialog.getByText(/immediately invalidates/)).toBeVisible();
    const confirmRotateButton = dialog.getByRole("button", {
      name: "Rotate and show new key",
    });
    await expect(confirmRotateButton).toBeFocused();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(rotateButton).toBeFocused();
    await rotateButton.click();
    await expect(confirmRotateButton).toBeFocused();
    await confirmRotateButton.click();
    await expect(
      dialog.getByText(/Replace the existing TIMETREE_API_KEY=/),
    ).toBeVisible();
    await expect(
      dialog.getByText(/keep exactly one definition/),
    ).toBeVisible();
    const secondCredentialLine = await credentialValue.textContent();
    expect(
      /^TIMETREE_API_KEY=ttk_v1\./.test(secondCredentialLine ?? ""),
    ).toBe(true);
    expect(secondCredentialLine !== firstCredentialLine).toBe(true);
    await expect(closeButton).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Copy .env line" }),
    ).toBeFocused();
    const secondStoredCredential = await pool.query<{ id: string }>(
      `select id
       from agent_api_keys
       where user_id = $1 and root_node_id = $2`,
      [seeded.userId, seeded.nodeId],
    );
    expect(
      secondStoredCredential.rows[0].id !==
        firstStoredCredential.rows[0].id,
    ).toBe(true);

    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();
    await expect(verificationButton).toBeFocused();
    const revokeButton = dialog.getByRole("button", {
      name: "Revoke API key",
    });
    await revokeButton.click();
    await expect(dialog.getByText(/immediately disconnects/)).toBeVisible();
    const confirmRevokeButton = dialog.getByRole("button", {
      name: "Revoke agent access",
    });
    await expect(confirmRevokeButton).toBeFocused();
    await confirmRevokeButton.click();
    const createButton = dialog.getByRole("button", {
      name: "Create API key",
    });
    await expect(createButton).toBeVisible();
    await expect(createButton).toBeFocused();
    const remainingCredentials = await pool.query<{ count: string }>(
      `select count(*)::text as count
       from agent_api_keys
       where user_id = $1 and root_node_id = $2`,
      [seeded.userId, seeded.nodeId],
    );
    expect(remainingCredentials.rows[0].count).toBe("0");

    await closeButton.click();
    await expect(
      page.getByRole("button", { name: "Set up agent access" }),
    ).toBeFocused();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
  } finally {
    await page
      .evaluate(() => navigator.clipboard.writeText(""))
      .catch(() => undefined);
    await seeded.cleanup();
  }
});

test("keeps a long-title agent dialog within its scrollable frame", async ({
  context,
  page,
}) => {
  const longTitle = `Agent scope ${"with a long descriptive title ".repeat(7)}`.slice(
    0,
    200,
  );
  const seeded = await seedAgentAccessNode(longTitle);

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
    await page.goto(`/?node=${seeded.nodeId}`);
    await page.getByRole("button", { name: "Set up agent access" }).click();
    const dialog = page.getByRole("dialog", {
      name: `Agent access for ${longTitle}`,
    });
    await expect(dialog).toBeVisible();
    const layout = await dialog.evaluate((element) => {
      const body = element.querySelector<HTMLElement>(
        ".agent-access-dialog__body",
      );
      if (!body) {
        return null;
      }
      const dialogBox = element.getBoundingClientRect();
      const bodyBox = body.getBoundingClientRect();
      return {
        bodyBottom: bodyBox.bottom,
        dialogBottom: dialogBox.bottom,
      };
    });
    expect(layout).not.toBeNull();
    expect(layout!.bodyBottom <= layout!.dialogBottom + 1).toBe(true);
    await dialog
      .locator(".agent-access-dialog__body")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await expect(
      dialog.getByRole("button", { name: "Create API key" }),
    ).toBeVisible();
  } finally {
    await seeded.cleanup();
  }
});

test("keeps key management available when harness setup is unavailable", async ({
  context,
  page,
}) => {
  const seeded = await seedAgentAccessNode();

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
    await page.goto(`/?node=${seeded.nodeId}`);
    await page.getByRole("button", { name: "Set up agent access" }).click();
    let dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Create API key" }).click();
    await dialog
      .getByRole("button", { name: "I’ve saved the key" })
      .click();
    await dialog
      .getByRole("button", { name: "Close agent access dialog" })
      .click();

    await page.addInitScript(() => {
      const originalResolvedOptions =
        Intl.DateTimeFormat.prototype.resolvedOptions;
      Intl.DateTimeFormat.prototype.resolvedOptions =
        function resolvedOptions() {
          return {
            ...originalResolvedOptions.call(this),
            timeZone: "Invalid/TimeZone",
          };
        };
    });
    await page.reload();
    await page.getByRole("button", { name: "Manage agent access" }).click();
    dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Codex setup needs a valid browser calendar time zone."),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", {
        name: "Copy connection verification prompt",
      }),
    ).toBeEnabled();
    await expect(
      dialog.getByText("Manual connection verification prompt"),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Rotate API key" }),
    ).toBeEnabled();
    await dialog.getByRole("button", { name: "Rotate API key" }).click();
    await dialog
      .getByRole("button", { name: "Rotate and show new key" })
      .click();
    await expect(
      dialog.getByText(/Replace the existing TIMETREE_API_KEY=/),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "I’ve saved the key" })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "Copy connection verification prompt",
      }),
    ).toBeFocused();
    await dialog.getByRole("button", { name: "Revoke API key" }).click();
    await dialog
      .getByRole("button", { name: "Revoke agent access" })
      .click();
    await expect(
      dialog.getByRole("button", { name: "Create API key" }),
    ).toBeEnabled();
    await expect(
      dialog.getByRole("button", { name: "Create API key" }),
    ).toBeFocused();
    await dialog.getByRole("button", { name: "Create API key" }).click();
    await expect(
      dialog.getByText(/Add this exact line to the repository-root/),
    ).toBeVisible();
    await dialog
      .getByRole("button", { name: "I’ve saved the key" })
      .click();
    await expect(
      dialog.getByRole("button", {
        name: "Copy connection verification prompt",
      }),
    ).toBeFocused();
  } finally {
    await seeded.cleanup();
  }
});

test("reconciles stale create, rotate, and revoke controls across pages", async ({
  context,
  page,
}) => {
  const seeded = await seedAgentAccessNode();
  await pool.query(
    `insert into nodes (user_id, position, title)
     values ($1, 1, 'Unrelated synthetic scope')`,
    [seeded.userId],
  );
  const secondPage = await context.newPage();

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
    await Promise.all([
      page.goto(`/?node=${seeded.nodeId}`),
      secondPage.goto(`/?node=${seeded.nodeId}`),
    ]);
    await Promise.all([
      page.getByRole("button", { name: "Set up agent access" }).click(),
      secondPage
        .getByRole("button", { name: "Set up agent access" })
        .click(),
    ]);
    const firstDialog = page.getByRole("dialog");
    const secondDialog = secondPage.getByRole("dialog");

    await firstDialog.getByRole("button", { name: "Create API key" }).click();
    await firstDialog
      .getByRole("button", { name: "I’ve saved the key" })
      .click();

    await secondDialog.getByRole("button", { name: "Create API key" }).click();
    await expect(secondDialog).toHaveCount(0);
    await expect(secondPage.locator(".detail-error[role='alert']")).toContainText(
      "Current agent access has been refreshed.",
    );
    const refreshedManageTrigger = secondPage.getByRole("button", {
      name: "Manage agent access",
    });
    await expect(refreshedManageTrigger).toBeFocused();
    if ((secondPage.viewportSize()?.width ?? 0) <= 760) {
      await secondPage.getByRole("button", { name: "Back to tree" }).click();
    }
    await secondPage
      .getByRole("button", {
        name: "Unrelated synthetic scope",
        exact: true,
      })
      .click();
    await expect(
      secondPage.getByRole("region", {
        name: "Node details for Unrelated synthetic scope",
      }),
    ).toBeVisible();
    await expect(
      secondPage.getByText(/Current agent access has been refreshed\./),
    ).toHaveCount(0);
    if ((secondPage.viewportSize()?.width ?? 0) <= 760) {
      await secondPage.getByRole("button", { name: "Back to tree" }).click();
    }
    await secondPage
      .getByRole("button", { name: "Synthetic agent scope", exact: true })
      .click();
    await secondPage
      .getByRole("button", { name: "Manage agent access" })
      .click();
    await expect(
      secondDialog.getByText("Active", { exact: true }),
    ).toBeVisible();

    await firstDialog.getByRole("button", { name: "Rotate API key" }).click();
    await firstDialog
      .getByRole("button", { name: "Rotate and show new key" })
      .click();
    await firstDialog
      .getByRole("button", { name: "I’ve saved the key" })
      .click();

    await secondDialog.getByRole("button", { name: "Revoke API key" }).click();
    await secondDialog
      .getByRole("button", { name: "Revoke agent access" })
      .click();
    await expect(secondDialog).toHaveCount(0);
    await expect(secondPage.locator(".detail-error[role='alert']")).toContainText(
      "Current agent access has been refreshed.",
    );
    const refreshedAfterRevoke = secondPage.getByRole("button", {
      name: "Manage agent access",
    });
    await expect(refreshedAfterRevoke).toBeFocused();
    await refreshedAfterRevoke.click();
    await expect(
      secondDialog.getByText("Active", { exact: true }),
    ).toBeVisible();
    await secondDialog.getByRole("button", { name: "Rotate API key" }).click();
    await secondDialog
      .getByRole("button", { name: "Rotate and show new key" })
      .click();
    await secondDialog
      .getByRole("button", { name: "I’ve saved the key" })
      .click();

    await firstDialog.getByRole("button", { name: "Revoke API key" }).click();
    await firstDialog
      .getByRole("button", { name: "Revoke agent access" })
      .click();
    await expect(firstDialog).toHaveCount(0);
    await expect(page.locator(".detail-error[role='alert']")).toContainText(
      "Current agent access has been refreshed.",
    );
    const refreshedAfterSecondRevoke = page.getByRole("button", {
      name: "Manage agent access",
    });
    await expect(refreshedAfterSecondRevoke).toBeFocused();
    await refreshedAfterSecondRevoke.click();
    await expect(
      firstDialog.getByText("Active", { exact: true }),
    ).toBeVisible();

    await secondDialog.getByRole("button", { name: "Revoke API key" }).click();
    await secondDialog
      .getByRole("button", { name: "Revoke agent access" })
      .click();
    await expect(
      secondDialog.getByRole("button", { name: "Create API key" }),
    ).toBeVisible();

    await firstDialog.getByRole("button", { name: "Rotate API key" }).click();
    await firstDialog
      .getByRole("button", { name: "Rotate and show new key" })
      .click();
    await expect(firstDialog).toHaveCount(0);
    await expect(page.locator(".detail-error[role='alert']")).toContainText(
      "Current agent access has been refreshed.",
    );
    const refreshedSetupTrigger = page.getByRole("button", {
      name: "Set up agent access",
    });
    await expect(refreshedSetupTrigger).toBeFocused();
    await refreshedSetupTrigger.click();
    await expect(
      firstDialog.getByRole("button", { name: "Create API key" }),
    ).toBeVisible();
  } finally {
    await secondPage.close();
    await seeded.cleanup();
  }
});
