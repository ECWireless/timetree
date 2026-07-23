import { describe, expect, it } from "vitest";

import {
  getWorkDateInTimeZone,
  isValidIanaTimeZone,
} from "../../src/lib/agent/time-zone";

describe("agent calendar time zone", () => {
  it("validates bounded IANA zones without trimming caller input", () => {
    expect(isValidIanaTimeZone("America/Los_Angeles")).toBe(true);
    expect(isValidIanaTimeZone("Pacific/Kiritimati")).toBe(true);
    expect(isValidIanaTimeZone("UTC")).toBe(true);
    expect(isValidIanaTimeZone("Etc/GMT+8")).toBe(true);
    expect(isValidIanaTimeZone("+08:00")).toBe(false);
    expect(isValidIanaTimeZone("-05:30")).toBe(false);
    expect(isValidIanaTimeZone(" America/Los_Angeles")).toBe(false);
    expect(isValidIanaTimeZone("Not/A_Real_Zone")).toBe(false);
    expect(isValidIanaTimeZone("x".repeat(101))).toBe(false);
  });

  it("derives the local calendar date from an exact server timestamp", () => {
    const timestamp = new Date("2026-01-01T00:30:00.000Z");

    expect(getWorkDateInTimeZone(timestamp, "UTC")).toBe("2026-01-01");
    expect(getWorkDateInTimeZone(timestamp, "America/Los_Angeles")).toBe(
      "2025-12-31",
    );
    expect(getWorkDateInTimeZone(timestamp, "Pacific/Kiritimati")).toBe(
      "2026-01-01",
    );
  });

  it("handles daylight-saving boundaries as calendar dates", () => {
    expect(
      getWorkDateInTimeZone(
        new Date("2026-03-08T09:59:59.000Z"),
        "America/Los_Angeles",
      ),
    ).toBe("2026-03-08");
    expect(
      getWorkDateInTimeZone(
        new Date("2026-11-01T09:00:00.000Z"),
        "America/Los_Angeles",
      ),
    ).toBe("2026-11-01");
  });
});
