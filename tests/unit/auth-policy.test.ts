import { describe, expect, it } from "vitest";

import {
  assertAuthorizedSession,
  AuthorizationError,
  isAllowedIdentity,
} from "../../src/lib/auth/policy";

const allowedSession = {
  user: {
    id: "synthetic-user",
    email: "person@example.com",
    emailVerified: true,
  },
};

describe("single-account authorization policy", () => {
  it("accepts a verified normalized allowlist match", () => {
    expect(assertAuthorizedSession(allowedSession, " Person@Example.COM ")).toBe(allowedSession);
    expect(isAllowedIdentity(allowedSession.user, " Person@Example.COM ")).toBe(true);
  });

  it("rejects a missing session", () => {
    expect(() => assertAuthorizedSession(null, "person@example.com")).toThrow(
      new AuthorizationError("missing-session"),
    );
  });

  it("rejects an unverified email", () => {
    expect(() =>
      assertAuthorizedSession(
        { user: { ...allowedSession.user, emailVerified: false } },
        "person@example.com",
      ),
    ).toThrow(new AuthorizationError("unverified-email"));
  });

  it("rejects a different email", () => {
    expect(() => assertAuthorizedSession(allowedSession, "someone-else@example.com")).toThrow(
      new AuthorizationError("disallowed-email"),
    );
  });

  it("rejects a retained session after the allowlist changes", () => {
    expect(assertAuthorizedSession(allowedSession, "person@example.com")).toBe(allowedSession);
    expect(() => assertAuthorizedSession(allowedSession, "replacement@example.com")).toThrow(
      new AuthorizationError("disallowed-email"),
    );
  });
});
