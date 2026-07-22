export type DashboardPeriodInput =
  | { mode: "all" }
  | { mode: "day"; day: string }
  | { mode: "month"; month: string };

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
