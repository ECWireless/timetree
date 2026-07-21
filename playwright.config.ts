import { defineConfig, devices } from "@playwright/test";

try {
  process.loadEnvFile(".env");
} catch (error) {
  if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
    throw error;
  }
}

const port = 3187;
const baseURL = `http://127.0.0.1:${port}`;
const testAuthEnv = {
  ...process.env,
  BETTER_AUTH_SECRET: "synthetic-auth-secret-for-browser-tests-only",
  BETTER_AUTH_URL: baseURL,
  GOOGLE_CLIENT_ID: "synthetic-google-client-id",
  GOOGLE_CLIENT_SECRET: "synthetic-google-client-secret",
  ALLOWED_EMAIL: "browser-user@example.test",
};

export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: true,
  workers: 1,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  reporter: "list",
  use: {
    baseURL,
    trace: "on-first-retry",
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"] },
    },
    {
      name: "mobile",
      use: { ...devices["Pixel 5"] },
    },
  ],
  webServer: {
    command: `corepack pnpm dev --hostname 127.0.0.1 --port ${port}`,
    url: baseURL,
    env: testAuthEnv,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
