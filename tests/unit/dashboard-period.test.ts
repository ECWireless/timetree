import { describe, expect, it } from "vitest";

import {
  DashboardPeriodError,
  defaultDashboardPeriod,
  resolveDashboardPeriod,
  resolveDashboardPeriodSearchParams,
} from "../../src/lib/time-entries/period";

describe("dashboard periods", () => {
  it("derives day and month defaults from the browser-local calendar date", () => {
    const priorTimezone = process.env.TZ;
    process.env.TZ = "America/Los_Angeles";
    try {
      const instant = new Date("2026-08-01T00:30:00.000Z");
      expect(defaultDashboardPeriod("all", instant)).toEqual({ mode: "all" });
      expect(defaultDashboardPeriod("day", instant)).toEqual({
        mode: "day",
        day: "2026-07-31",
      });
      expect(defaultDashboardPeriod("month", instant)).toEqual({
        mode: "month",
        month: "2026-07",
      });
    } finally {
      if (priorTimezone === undefined) {
        delete process.env.TZ;
      } else {
        process.env.TZ = priorTimezone;
      }
    }
  });

  it("resolves the all-time period without date bounds", () => {
    expect(resolveDashboardPeriod({ mode: "all" })).toEqual({
      mode: "all",
      startDate: null,
      endDateExclusive: null,
    });
  });

  it("resolves exact day bounds across calendar boundaries", () => {
    expect(resolveDashboardPeriod({ mode: "day", day: "2024-02-29" })).toEqual({
      mode: "day",
      day: "2024-02-29",
      startDate: "2024-02-29",
      endDateExclusive: "2024-03-01",
    });
    expect(resolveDashboardPeriod({ mode: "day", day: "2026-12-31" })).toEqual({
      mode: "day",
      day: "2026-12-31",
      startDate: "2026-12-31",
      endDateExclusive: "2027-01-01",
    });
    expect(resolveDashboardPeriod({ mode: "day", day: "9999-12-31" })).toMatchObject({
      endDateExclusive: "10000-01-01",
    });
  });

  it("resolves exact month bounds across year boundaries", () => {
    expect(resolveDashboardPeriod({ mode: "month", month: "2026-07" })).toEqual({
      mode: "month",
      month: "2026-07",
      startDate: "2026-07-01",
      endDateExclusive: "2026-08-01",
    });
    expect(resolveDashboardPeriod({ mode: "month", month: "2026-12" })).toEqual({
      mode: "month",
      month: "2026-12",
      startDate: "2026-12-01",
      endDateExclusive: "2027-01-01",
    });
  });

  it.each([
    { mode: "day", day: "2025-02-29" },
    { mode: "day", day: "2026-02-30" },
    { mode: "day", day: "2026-7-01" },
    { mode: "day", day: "0000-01-01" },
    { mode: "month", month: "2026-7" },
    { mode: "month", month: "2026-13" },
    { mode: "month", month: "0000-01" },
    { mode: "day", day: ["2026-07-22"] },
    { mode: "month", month: new String("2026-07") },
    { mode: "invalid" },
    null,
    ["all"],
    new Date(),
    Object.create(null),
  ])("rejects invalid input %#", (input) => {
    expect(() => resolveDashboardPeriod(input)).toThrow(DashboardPeriodError);
  });
});

describe("dashboard period URL state", () => {
  it("keeps canonical all-time, day, and month state", () => {
    expect(resolveDashboardPeriodSearchParams({})).toEqual({
      period: { mode: "all" },
      requiresCanonicalization: false,
    });
    expect(
      resolveDashboardPeriodSearchParams({ period: "day", day: "2026-07-22" }),
    ).toEqual({
      period: { mode: "day", day: "2026-07-22" },
      requiresCanonicalization: false,
    });
    expect(
      resolveDashboardPeriodSearchParams({ period: "month", month: "2026-07" }),
    ).toEqual({
      period: { mode: "month", month: "2026-07" },
      requiresCanonicalization: false,
    });
  });

  it("keeps a valid active value while removing the inactive mode", () => {
    expect(
      resolveDashboardPeriodSearchParams({
        period: "day",
        day: "2026-07-22",
        month: "2026-06",
      }),
    ).toEqual({
      period: { mode: "day", day: "2026-07-22" },
      requiresCanonicalization: true,
    });
  });

  it.each([
    { period: "day" },
    { period: "day", day: "2026-02-30" },
    { period: "month", month: "bad" },
    { period: "week", day: "2026-07-22" },
    { day: "2026-07-22" },
    { month: "2026-07" },
    { period: ["day", "month"], day: "2026-07-22" },
    { period: "day", day: ["2026-07-22", "2026-07-23"] },
  ])("canonicalizes invalid state %# to all time", (params) => {
    expect(resolveDashboardPeriodSearchParams(params)).toEqual({
      period: { mode: "all" },
      requiresCanonicalization: true,
    });
  });
});
