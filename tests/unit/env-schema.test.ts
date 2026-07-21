import { describe, expect, it } from "vitest";

import { serverEnvSchema } from "../../src/lib/env-schema";

const validEnv = {
  DATABASE_URL: "postgresql://app:secret@localhost:5432/app",
  DATABASE_URL_UNPOOLED: "postgresql://app:secret@localhost:5432/app",
  BETTER_AUTH_SECRET: "a-synthetic-secret-that-is-long-enough",
  BETTER_AUTH_URL: "http://localhost:3000",
  GOOGLE_CLIENT_ID: "synthetic-client-id",
  GOOGLE_CLIENT_SECRET: "synthetic-client-secret",
  ALLOWED_EMAIL: "person@example.com",
};

describe("serverEnvSchema", () => {
  it("accepts the expected server configuration", () => {
    expect(serverEnvSchema.parse(validEnv)).toEqual(validEnv);
  });

  it("treats a blank optional unpooled URL as unset", () => {
    expect(
      serverEnvSchema.parse({
        ...validEnv,
        DATABASE_URL_UNPOOLED: "",
      }).DATABASE_URL_UNPOOLED,
    ).toBeUndefined();
  });

  it("normalizes the allowed email", () => {
    expect(
      serverEnvSchema.parse({
        ...validEnv,
        ALLOWED_EMAIL: " Person@Example.COM ",
      }).ALLOWED_EMAIL,
    ).toBe("person@example.com");
  });

  it.each([
    ["DATABASE_URL", "not-a-url"],
    ["DATABASE_URL_UNPOOLED", "not-a-url"],
    ["BETTER_AUTH_SECRET", "too-short"],
    ["BETTER_AUTH_URL", "not-a-url"],
    ["GOOGLE_CLIENT_ID", ""],
    ["GOOGLE_CLIENT_SECRET", ""],
    ["ALLOWED_EMAIL", "not-an-email"],
  ] as const)("rejects an invalid %s", (field, value) => {
    const result = serverEnvSchema.safeParse({
      ...validEnv,
      [field]: value,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.issues.some((issue) => issue.path[0] === field)).toBe(true);
    }
  });
});
