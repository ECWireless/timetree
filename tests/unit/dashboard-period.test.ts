import { describe, expect, it } from "vitest";

import {
  DashboardPeriodError,
  resolveDashboardPeriod,
} from "../../src/lib/time-entries/period";

describe("dashboard periods", () => {
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
