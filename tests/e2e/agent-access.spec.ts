import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
} from "@playwright/test";
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

async function addSessionCookie(
  context: BrowserContext,
  cookie: string,
) {
  await context.addCookies([
    {
      name: "better-auth.session_token",
      value: cookie,
      domain: "127.0.0.1",
      path: "/",
      httpOnly: true,
      sameSite: "Lax",
    },
  ]);
}

function keyCard(dialog: Locator, label: string) {
  return dialog.locator(".agent-key-card").filter({ hasText: label });
}

async function createKey(
  dialog: Locator,
  label: string,
  accessLevel: "read_only" | "read_write",
) {
  await dialog.getByLabel("Key label").fill(label);
  if (accessLevel === "read_only") {
    await dialog.getByRole("radio", { name: /Read only/ }).check();
  }
  await dialog.getByRole("button", { name: "Create key" }).click();
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
          element.textContent = "[redacted]";
        }
      })
      .catch(() => undefined);
  }
});

test("manages labeled read-write and read-only keys independently", async ({
  context,
  page,
}) => {
  const seeded = await seedAgentAccessNode();

  try {
    await context.grantPermissions(
      ["clipboard-read", "clipboard-write"],
      { origin: "http://127.0.0.1:3187" },
    );
    await addSessionCookie(context, seeded.cookie);
    await page.goto(`/?node=${seeded.nodeId}`);

    await page.getByRole("button", { name: "Set up agent access" }).click();
    const dialog = page.getByRole("dialog", {
      name: "Agent access for Synthetic agent scope",
    });
    await expectCenteredDialog(page, dialog);
    await expect(dialog.getByText("Once per Codex installation")).toBeVisible();
    await expect(dialog.getByText("Per application or client")).toBeVisible();
    await expect(dialog.getByText(/Calendar time zone:/)).toBeVisible();

    const setupCopyButton = dialog.getByRole("button", {
      name: "Copy Codex setup prompt",
    });
    await expectHorizontalIconButton(setupCopyButton);
    await setupCopyButton.click();
    const setupPrompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(setupPrompt).toContain("Install this deployment's TimeTree skill");
    expect(setupPrompt).toContain(
      "http://127.0.0.1:3187/api/agent/v1/tree",
    );
    expect(setupPrompt).not.toContain("ttk_v2.");
    expect(setupPrompt).not.toContain(seeded.nodeId);

    await dialog.getByLabel("Key label").fill("   ");
    await dialog.getByRole("button", { name: "Create key" }).click();
    await expect(dialog.getByText("Enter a label.")).toBeVisible();
    await expect(dialog.getByLabel("Key label")).toBeFocused();
    await createKey(dialog, "Application", "read_write");
    const closeButton = dialog.getByRole("button", {
      name: "Close agent access dialog",
    });
    await expect(closeButton).toBeDisabled();
    await expect(
      dialog.getByRole("button", { name: "Copy raw API key" }),
    ).toBeFocused();
    const secretValues = await dialog
      .locator(".agent-secret__value code")
      .allTextContents();
    expect(secretValues).toHaveLength(2);
    expect(secretValues[0]).toMatch(
      /^ttk_v2\.[0-9a-f-]{36}\.[A-Za-z0-9_-]{43}$/,
    );
    expect(secretValues[1]).toBe(`TIMETREE_API_KEY=${secretValues[0]}`);

    await dialog.getByRole("button", { name: "Copy raw API key" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
      secretValues[0],
    );
    await dialog.getByRole("button", { name: "Copy .env line" }).click();
    await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe(
      secretValues[1],
    );
    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();

    const applicationCard = keyCard(dialog, "Application");
    await expect(applicationCard).toContainText("Read and write");
    await expect(applicationCard.getByRole("button", { name: "Rotate key" })).toBeFocused();
    await dialog.getByRole("button", { name: "Add API key" }).click();
    await createKey(dialog, "Client", "read_only");
    await expect(dialog.locator(".agent-secret__value code")).toHaveCount(2);
    const clientSecret = (
      await dialog.locator(".agent-secret__value code").allTextContents()
    )[0];
    expect(clientSecret).toMatch(/^ttk_v2\./);
    expect(clientSecret).not.toBe(secretValues[0]);
    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();

    const clientCard = keyCard(dialog, "Client");
    await expect(clientCard).toContainText("Read only");
    await clientCard
      .getByRole("button", { name: "Copy client-agent setup prompt" })
      .click();
    const clientPrompt = await page.evaluate(() => navigator.clipboard.readText());
    expect(clientPrompt).toContain(
      "http://127.0.0.1:3187/api/agent/v1/openapi.json",
    );
    expect(clientPrompt).toContain("Permit exactly these operations");
    expect(clientPrompt).toContain("Never call POST, PUT, DELETE");
    expect(clientPrompt).toContain("untrusted data");
    expect(clientPrompt).not.toContain(clientSecret);
    expect(clientPrompt).not.toContain(seeded.nodeId);
    await page.evaluate(() => {
      Object.defineProperty(navigator.clipboard, "writeText", {
        configurable: true,
        value: () => Promise.reject(new DOMException("Denied")),
      });
    });
    await clientCard
      .getByRole("button", { name: "Copy verification prompt" })
      .click();
    await expect(
      dialog.getByText("Copy failed. Select the value or prompt below."),
    ).toBeVisible();
    await clientCard.getByText("View prompts manually").click();
    await expect(
      clientCard.getByText("Connection verification prompt", { exact: true }),
    ).toBeVisible();
    await expect(
      clientCard.getByText("Read-only client-agent setup prompt", {
        exact: true,
      }),
    ).toBeVisible();

    const stored = await pool.query<{
      access_level: string;
      label: string;
      secret_hash: string;
    }>(
      `select label, access_level, secret_hash
       from agent_api_keys
       where user_id = $1 and root_node_id = $2
       order by label`,
      [seeded.userId, seeded.nodeId],
    );
    expect(stored.rows).toEqual([
      {
        access_level: "read_write",
        label: "Application",
        secret_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
      {
        access_level: "read_only",
        label: "Client",
        secret_hash: expect.stringMatching(/^[0-9a-f]{64}$/),
      },
    ]);

    await clientCard.getByRole("button", { name: "Rotate key" }).click();
    const rotateForm = clientCard.getByRole("form", { name: "Rotate Client" });
    await expect(
      rotateForm.getByRole("button", { name: "Rotate and show new key" }),
    ).toBeFocused();
    await rotateForm.getByLabel("Key label").fill("   ");
    await rotateForm
      .getByRole("button", { name: "Rotate and show new key" })
      .click();
    await expect(rotateForm.getByText("Enter a label.")).toBeVisible();
    await expect(rotateForm.getByLabel("Key label")).toBeFocused();
    await rotateForm.getByLabel("Key label").fill("Client reporting");
    await expect(rotateForm.getByLabel("Key label")).toBeFocused();
    await rotateForm
      .getByRole("button", { name: "Rotate and show new key" })
      .click();
    await expect(dialog.locator(".agent-secret__value code")).toHaveCount(2);
    const rotatedSecret = (
      await dialog.locator(".agent-secret__value code").allTextContents()
    )[0];
    expect(rotatedSecret).toMatch(/^ttk_v2\./);
    expect(rotatedSecret).not.toBe(clientSecret);
    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();
    await expect(keyCard(dialog, "Client reporting")).toContainText("Read only");

    await applicationCard.getByRole("button", { name: "Revoke key" }).click();
    await expect(
      applicationCard.getByRole("button", { name: "Revoke API key" }),
    ).toBeFocused();
    await applicationCard
      .getByRole("button", { name: "Revoke API key" })
      .click();
    await expect(applicationCard).toHaveCount(0);
    await expect(keyCard(dialog, "Client reporting")).toBeVisible();

    await closeButton.click();
    await expect(
      page.getByRole("button", { name: "Manage 1 key" }),
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

test("keeps a long-title multi-key dialog usable at 350px", async ({
  context,
  page,
}) => {
  const longTitle = `Agent scope ${"with a long descriptive title ".repeat(7)}`.slice(
    0,
    200,
  );
  const seeded = await seedAgentAccessNode(longTitle);

  try {
    await page.setViewportSize({ width: 350, height: 800 });
    await addSessionCookie(context, seeded.cookie);
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
        dialogLeft: dialogBox.left,
        dialogRight: dialogBox.right,
        viewportWidth: window.innerWidth,
      };
    });
    expect(layout).not.toBeNull();
    expect(layout!.bodyBottom <= layout!.dialogBottom + 1).toBe(true);
    expect(layout!.dialogLeft >= 0).toBe(true);
    expect(layout!.dialogRight <= layout!.viewportWidth).toBe(true);
    await dialog
      .locator(".agent-access-dialog__body")
      .evaluate((element) => element.scrollTo(0, element.scrollHeight));
    await createKey(
      dialog,
      "Application with a deliberately long identifying label",
      "read_write",
    );
    await expect(dialog.locator(".agent-secret__copies")).toBeVisible();
    await expect(dialog.locator(".agent-secret__value").first()).toBeVisible();
    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();
    await dialog.getByRole("button", { name: "Add API key" }).click();
    await createKey(dialog, "Client reporting", "read_only");
    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();
    await expect(dialog.locator(".agent-key-card")).toHaveCount(2);
    await expect(dialog.getByText("2 active")).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Rotate key" }).first(),
    ).toBeVisible();
    await expect(
      dialog.getByRole("button", { name: "Revoke key" }).last(),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () =>
          document.documentElement.scrollWidth >
          document.documentElement.clientWidth,
      ),
    ).toBe(false);
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
    await addSessionCookie(context, seeded.cookie);
    await page.goto(`/?node=${seeded.nodeId}`);
    await page.getByRole("button", { name: "Set up agent access" }).click();
    let dialog = page.getByRole("dialog");
    await createKey(dialog, "Application", "read_write");
    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();
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
    await page.getByRole("button", { name: "Manage 1 key" }).click();
    dialog = page.getByRole("dialog");
    await expect(
      dialog.getByText("Codex setup needs a valid browser calendar time zone."),
    ).toBeVisible();
    const applicationCard = keyCard(dialog, "Application");
    await expect(
      applicationCard.getByRole("button", { name: "Copy verification prompt" }),
    ).toBeEnabled();
    await expect(
      applicationCard.getByRole("button", { name: "Rotate key" }),
    ).toBeEnabled();
    await expect(
      applicationCard.getByRole("button", { name: "Revoke key" }),
    ).toBeEnabled();
  } finally {
    await seeded.cleanup();
  }
});

test("distinguishes duplicate key labels with stable references", async ({
  context,
  page,
}) => {
  const seeded = await seedAgentAccessNode();

  try {
    await addSessionCookie(context, seeded.cookie);
    await page.goto(`/?node=${seeded.nodeId}`);
    await page.getByRole("button", { name: "Set up agent access" }).click();
    const dialog = page.getByRole("dialog");

    await createKey(dialog, "Duplicate", "read_write");
    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();
    await dialog.getByRole("button", { name: "Add API key" }).click();
    await createKey(dialog, "Duplicate", "read_write");
    await dialog.getByRole("button", { name: "I’ve saved the key" }).click();

    const cards = dialog.locator(".agent-key-card");
    await expect(cards).toHaveCount(2);
    const references = await cards
      .locator(".agent-key-card__heading code")
      .allTextContents();
    expect(references).toHaveLength(2);
    expect(references[0]).toMatch(/^…[0-9a-f]{8}$/);
    expect(references[1]).toMatch(/^…[0-9a-f]{8}$/);
    expect(references[0]).not.toBe(references[1]);

    const revokeButtons = dialog.getByRole("button", {
      name: /Revoke key Duplicate, key/,
    });
    await expect(revokeButtons).toHaveCount(2);
    const actionNames = await revokeButtons.evaluateAll((buttons) =>
      buttons.map((button) => button.getAttribute("aria-label")),
    );
    expect(new Set(actionNames).size).toBe(2);

    await revokeButtons.first().click();
    await dialog
      .getByRole("button", {
        name: `Revoke API key Duplicate, key ${references[0]!.slice(1)}`,
      })
      .click();
    await expect(cards).toHaveCount(1);
    await expect(dialog.getByText("1 active")).toBeVisible();
    await expect(
      cards.locator(".agent-key-card__heading code"),
    ).toHaveText(references[1]!);
    const remainingCredentials = await pool.query<{ id: string }>(
      `select id
       from agent_api_keys
       where user_id = $1 and root_node_id = $2`,
      [seeded.userId, seeded.nodeId],
    );
    expect(remainingCredentials.rows).toHaveLength(1);
    expect(`…${remainingCredentials.rows[0].id.slice(-8)}`).toBe(references[1]);
  } finally {
    await seeded.cleanup();
  }
});

test("keeps concurrently created sibling keys independent across pages", async ({
  context,
  page,
}) => {
  const seeded = await seedAgentAccessNode();
  const secondPage = await context.newPage();

  try {
    await addSessionCookie(context, seeded.cookie);
    await Promise.all([
      page.goto(`/?node=${seeded.nodeId}`),
      secondPage.goto(`/?node=${seeded.nodeId}`),
    ]);
    await Promise.all([
      page.getByRole("button", { name: "Set up agent access" }).click(),
      secondPage.getByRole("button", { name: "Set up agent access" }).click(),
    ]);
    const firstDialog = page.getByRole("dialog");
    const secondDialog = secondPage.getByRole("dialog");

    await createKey(firstDialog, "Page one", "read_write");
    await firstDialog.getByRole("button", { name: "I’ve saved the key" }).click();
    await createKey(secondDialog, "Page two", "read_only");
    await secondDialog.getByRole("button", { name: "I’ve saved the key" }).click();
    await expect(keyCard(secondDialog, "Page one")).toBeVisible();
    await expect(keyCard(secondDialog, "Page two")).toBeVisible();
    await expect(secondDialog.getByText("2 active")).toBeVisible();

    const createdCredentials = await pool.query<{ id: string }>(
      `select id
       from agent_api_keys
       where user_id = $1 and root_node_id = $2`,
      [seeded.userId, seeded.nodeId],
    );
    expect(createdCredentials.rows).toHaveLength(2);

    const firstCard = keyCard(firstDialog, "Page one");
    await firstCard.getByRole("button", { name: "Rotate key" }).click();
    await firstCard
      .getByRole("button", { name: "Rotate and show new key" })
      .click();
    await firstDialog.getByRole("button", { name: "I’ve saved the key" }).click();
    await expect(keyCard(firstDialog, "Page two")).toBeVisible();
    await expect(firstDialog.getByText("2 active")).toBeVisible();

    const secondCard = keyCard(secondDialog, "Page two");
    await secondCard.getByRole("button", { name: "Revoke key" }).click();
    await secondCard.getByRole("button", { name: "Revoke API key" }).click();
    await expect(keyCard(secondDialog, "Page one")).toBeVisible();
    await expect(secondDialog.getByText("1 active")).toBeVisible();
    await expect(secondDialog.getByRole("button", { name: "Create key" })).toHaveCount(0);

    const rotatedFirstCard = keyCard(firstDialog, "Page one");
    await rotatedFirstCard.getByRole("button", { name: "Revoke key" }).click();
    await rotatedFirstCard
      .getByRole("button", { name: "Revoke API key" })
      .click();
    await expect(firstDialog.getByRole("button", { name: "Create key" })).toBeVisible();

    const remainingCredentials = await pool.query<{ count: string }>(
      `select count(*)::text as count
       from agent_api_keys
       where user_id = $1 and root_node_id = $2`,
      [seeded.userId, seeded.nodeId],
    );
    expect(remainingCredentials.rows[0].count).toBe("0");
  } finally {
    await secondPage.close();
    await seeded.cleanup();
  }
});
