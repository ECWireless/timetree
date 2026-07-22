import { toLocalWorkDate } from "./dates";

export type DashboardPeriodInput =
  | { mode: "all" }
  | { mode: "day"; day: string }
  | { mode: "month"; month: string };

export type DashboardPeriodSearchParams = {
  day?: string | string[];
  month?: string | string[];
  period?: string | string[];
};

export type DashboardPeriodUrlResolution = {
  period: DashboardPeriodInput;
  requiresCanonicalization: boolean;
};

export type DashboardPeriod =
  | { mode: "all"; startDate: null; endDateExclusive: null }
  | {
      mode: "day";
      day: string;
      startDate: string;
      endDateExclusive: string;
    }
  | {
      mode: "month";
      month: string;
      startDate: string;
      endDateExclusive: string;
    };

export class DashboardPeriodError extends Error {
  constructor() {
    super("Dashboard period is invalid.");
    this.name = "DashboardPeriodError";
  }
}

export function defaultDashboardPeriod(
  mode: DashboardPeriodInput["mode"],
  now = new Date(),
): DashboardPeriodInput {
  if (mode === "all") {
    return { mode: "all" };
  }

  const localDay = toLocalWorkDate(now);
  return mode === "day"
    ? { mode: "day", day: localDay }
    : { mode: "month", month: localDay.slice(0, 7) };
}

function formatYear(year: number) {
  return year.toString().padStart(4, "0");
}

function formatMonth(year: number, month: number) {
  return `${formatYear(year)}-${month.toString().padStart(2, "0")}`;
}

function formatDay(year: number, month: number, day: number) {
  return `${formatMonth(year, month)}-${day.toString().padStart(2, "0")}`;
}

function isLeapYear(year: number) {
  return year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
}

function daysInMonth(year: number, month: number) {
  if (month === 2) {
    return isLeapYear(year) ? 29 : 28;
  }
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function nextMonth(year: number, month: number) {
  return month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

function nextDay(year: number, month: number, day: number) {
  if (day < daysInMonth(year, month)) {
    return { year, month, day: day + 1 };
  }
  const followingMonth = nextMonth(year, month);
  return { ...followingMonth, day: 1 };
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    Object.getPrototypeOf(value) === Object.prototype
  );
}

export function resolveDashboardPeriod(input: unknown): DashboardPeriod {
  if (!isPlainObject(input)) {
    throw new DashboardPeriodError();
  }

  if (input.mode === "all") {
    return { mode: "all", startDate: null, endDateExclusive: null };
  }

  if (input.mode === "month") {
    if (typeof input.month !== "string") {
      throw new DashboardPeriodError();
    }
    const match = /^(\d{4})-(\d{2})$/.exec(input.month);
    const year = match ? Number(match[1]) : 0;
    const month = match ? Number(match[2]) : 0;
    if (!match || year < 1 || month < 1 || month > 12) {
      throw new DashboardPeriodError();
    }
    const followingMonth = nextMonth(year, month);
    return {
      mode: "month",
      month: input.month,
      startDate: `${input.month}-01`,
      endDateExclusive: `${formatMonth(followingMonth.year, followingMonth.month)}-01`,
    };
  }

  if (input.mode === "day") {
    if (typeof input.day !== "string") {
      throw new DashboardPeriodError();
    }
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(input.day);
    const year = match ? Number(match[1]) : 0;
    const month = match ? Number(match[2]) : 0;
    const day = match ? Number(match[3]) : 0;
    if (
      !match ||
      year < 1 ||
      month < 1 ||
      month > 12 ||
      day < 1 ||
      day > daysInMonth(year, month)
    ) {
      throw new DashboardPeriodError();
    }
    const followingDay = nextDay(year, month, day);
    return {
      mode: "day",
      day: input.day,
      startDate: input.day,
      endDateExclusive: formatDay(
        followingDay.year,
        followingDay.month,
        followingDay.day,
      ),
    };
  }

  throw new DashboardPeriodError();
}

export function resolveDashboardPeriodSearchParams(
  params: DashboardPeriodSearchParams,
): DashboardPeriodUrlResolution {
  if (params.period === undefined && params.day === undefined && params.month === undefined) {
    return { period: { mode: "all" }, requiresCanonicalization: false };
  }

  if (params.period === "day" && typeof params.day === "string") {
    const period: DashboardPeriodInput = { mode: "day", day: params.day };
    try {
      resolveDashboardPeriod(period);
      return {
        period,
        requiresCanonicalization: params.month !== undefined,
      };
    } catch (error) {
      if (!(error instanceof DashboardPeriodError)) {
        throw error;
      }
    }
  }

  if (params.period === "month" && typeof params.month === "string") {
    const period: DashboardPeriodInput = { mode: "month", month: params.month };
    try {
      resolveDashboardPeriod(period);
      return {
        period,
        requiresCanonicalization: params.day !== undefined,
      };
    } catch (error) {
      if (!(error instanceof DashboardPeriodError)) {
        throw error;
      }
    }
  }

  return { period: { mode: "all" }, requiresCanonicalization: true };
}
