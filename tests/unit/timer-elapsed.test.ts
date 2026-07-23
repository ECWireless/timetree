import { describe, expect, it } from "vitest";

import { elapsedTimerSeconds, formatTimerDuration } from "../../src/lib/timers/elapsed";

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

  it("formats running time as H:MM:SS without wrapping hours", () => {
    expect(formatTimerDuration(0)).toBe("0:00:00");
    expect(formatTimerDuration(3_723)).toBe("1:02:03");
    expect(formatTimerDuration(360_005)).toBe("100:00:05");
  });
});
