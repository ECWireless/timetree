import { describe, expect, it } from "vitest";

import {
  getLocalDateTimeCandidates,
  isValidWorkDate,
  resolveRangeInput,
} from "../../src/lib/time-entries/dates";
import { formatHistoricalDuration, parseDuration } from "../../src/lib/time-entries/duration";
import {
  calculateRoundedValueCents,
  formatRate,
  formatUsd,
  parseRateCents,
  roundValueNumeratorToCents,
} from "../../src/lib/time-entries/money";

describe("duration parsing", () => {
  it.each([
    ["1h", 3_600],
    ["30m", 1_800],
    ["1h 30m", 5_400],
    ["1h30m", 5_400],
    ["90m", 5_400],
    ["1.5h", 5_400],
    ["0.0004h", 1],
    [" 2H 5M ", 7_500],
  ])("parses %s", (input, expected) => {
    expect(parseDuration(input)).toBe(expected);
  });

  it.each(["", "0h", "0m", "-1h", "1:30", "one hour", "1m 2h", "1.5m", "1h nope"])(
    "rejects %s",
    (input) => {
      expect(parseDuration(input)).toBeNull();
    },
  );

  it("rejects values outside the database integer range", () => {
    expect(parseDuration("596524h")).toBeNull();
    expect(parseDuration(`${"1".repeat(65)}h`)).toBeNull();
  });
});

describe("historical duration formatting", () => {
  it.each([
    [0, "0h"],
    [1, "<1m"],
    [59, "<1m"],
    [60, "1m"],
    [3_599, "59m"],
    [3_600, "1h"],
    [4_981, "1h 23m"],
  ])("formats %i seconds", (seconds, expected) => {
    expect(formatHistoricalDuration(seconds)).toBe(expected);
  });
});

describe("work dates", () => {
  it("accepts real ISO calendar dates only", () => {
    expect(isValidWorkDate("2024-02-29")).toBe(true);
    expect(isValidWorkDate("2025-02-29")).toBe(false);
    expect(isValidWorkDate("2026-13-01")).toBe(false);
    expect(isValidWorkDate("07/22/2026")).toBe(false);
  });

  it("preserves stored range history when displayed local fields are unchanged", () => {
    const resolved = resolveRangeInput({
      startedAtInput: "2026-07-21T22:30:00",
      endedAtInput: "2026-07-21T23:30:00",
      initialStartedAtInput: "2026-07-21T22:30:00",
      initialEndedAtInput: "2026-07-21T23:30:00",
      storedStartedAt: "2026-07-22T05:30:00.000Z",
      storedEndedAt: "2026-07-22T06:30:00.000Z",
      storedWorkDate: "2026-07-22",
      startOffsetMinutes: null,
      endOffsetMinutes: null,
    });
    expect(resolved).toEqual({
      ok: true,
      startedAt: "2026-07-22T05:30:00.000Z",
      endedAt: "2026-07-22T06:30:00.000Z",
      workDate: "2026-07-22",
      preserveStart: true,
      preserveEnd: true,
    });
  });

  it("requires disambiguation when a changed local time occurs twice", () => {
    const priorTimezone = process.env.TZ;
    process.env.TZ = "America/New_York";
    try {
      const candidates = getLocalDateTimeCandidates("2026-11-01T01:30:00");
      expect(candidates.map(({ offsetMinutes }) => offsetMinutes)).toEqual([-240, -300]);
      expect(
        resolveRangeInput({
          startedAtInput: "2026-11-01T01:30:00",
          endedAtInput: "2026-11-01T02:30:00",
          startOffsetMinutes: null,
          endOffsetMinutes: -300,
        }),
      ).toMatchObject({
        ok: false,
        fieldErrors: { startedAt: [expect.stringContaining("which occurrence")] },
      });
      expect(
        resolveRangeInput({
          startedAtInput: "2026-11-01T01:30:00",
          endedAtInput: "2026-11-01T02:30:00",
          startOffsetMinutes: -300,
          endOffsetMinutes: -300,
        }),
      ).toMatchObject({ ok: true, startedAt: "2026-11-01T01:30:00-05:00" });
    } finally {
      if (priorTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = priorTimezone;
      }
    }
  });
});

describe("rate and exact value math", () => {
  it("parses explicit zero and cent-precision dollar rates", () => {
    expect(parseRateCents("0")).toBe(0);
    expect(parseRateCents("125.5")).toBe(12_550);
    expect(parseRateCents("12.345")).toBeNull();
  });

  it("rounds only the final exact cent-second value", () => {
    expect(calculateRoundedValueCents(1, 1_800)).toBe(1);
    expect(calculateRoundedValueCents(3_599, 10_001)).toBe(9_998);
    expect(calculateRoundedValueCents(3_600, 10_001)).toBe(10_001);
    expect(roundValueNumeratorToCents(BigInt(1_799))).toBe(BigInt(0));
    expect(roundValueNumeratorToCents(BigInt(1_800))).toBe(BigInt(1));
  });

  it("formats USD values and hourly rates", () => {
    expect(formatUsd(12_550)).toBe("$125.50");
    expect(formatUsd("900719925474099201")).toBe("$9,007,199,254,740,992.01");
    expect(formatRate(0)).toBe("$0.00/hr");
  });
});
