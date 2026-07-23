import { describe, expect, it } from "vitest";

import {
  advanceClockFromSnapshot,
  elapsedTimerSeconds,
  formatTimerDuration,
} from "../../src/lib/timers/elapsed";

describe("running timer presentation", () => {
  it("reconstructs completed whole seconds from a persisted timestamp", () => {
    expect(
      elapsedTimerSeconds("2026-07-22T10:00:00.500Z", Date.parse("2026-07-22T11:02:03.999Z")),
    ).toBe(3_723);
  });

  it("clamps future and malformed timestamps for display", () => {
    expect(elapsedTimerSeconds("2026-07-22T10:00:01.000Z", Date.parse("2026-07-22T10:00:00Z"))).toBe(0);
    expect(elapsedTimerSeconds("not-a-date", Date.now())).toBe(0);
  });

  it("advances from the server snapshot instead of trusting a skewed client clock", () => {
    const serverSnapshot = Date.parse("2026-07-22T10:00:00Z");
    const clientSnapshot = Date.parse("2026-07-22T09:55:00Z");

    expect(advanceClockFromSnapshot(serverSnapshot, clientSnapshot, clientSnapshot + 2_500))
      .toBe(serverSnapshot + 2_500);
  });

  it("formats running time as H:MM:SS without wrapping hours", () => {
    expect(formatTimerDuration(0)).toBe("0:00:00");
    expect(formatTimerDuration(3_723)).toBe("1:02:03");
    expect(formatTimerDuration(360_005)).toBe("100:00:05");
  });
});
