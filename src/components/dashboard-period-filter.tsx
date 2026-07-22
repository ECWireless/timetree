"use client";

import { useEffect, useRef, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import {
  defaultDashboardPeriod,
  type DashboardPeriodInput,
} from "@/lib/time-entries/period";

type DashboardPeriodFilterProps = {
  period: DashboardPeriodInput;
  requiresCanonicalization: boolean;
};

function replacePeriodParams(params: URLSearchParams, period: DashboardPeriodInput) {
  params.delete("period");
  params.delete("day");
  params.delete("month");
  if (period.mode === "day") {
    params.set("period", "day");
    params.set("day", period.day);
  } else if (period.mode === "month") {
    params.set("period", "month");
    params.set("month", period.month);
  }
}

function targetUrl(params: URLSearchParams) {
  const query = params.toString();
  return query ? `/?${query}` : "/";
}

export function DashboardPeriodFilter({
  period,
  requiresCanonicalization,
}: DashboardPeriodFilterProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const queryString = searchParams.toString();
  const canonicalTargetRef = useRef<string | null>(null);
  const [isPending, startTransition] = useTransition();

  useEffect(() => {
    if (!requiresCanonicalization) {
      canonicalTargetRef.current = null;
      return;
    }
    const next = new URLSearchParams(queryString);
    replacePeriodParams(next, period);
    const target = targetUrl(next);
    if (canonicalTargetRef.current === target) {
      return;
    }
    canonicalTargetRef.current = target;
    startTransition(() => router.replace(target, { scroll: false }));
  }, [period, queryString, requiresCanonicalization, router]);

  function navigate(nextPeriod: DashboardPeriodInput) {
    if (isPending || requiresCanonicalization) {
      return;
    }
    const next = new URLSearchParams(queryString);
    replacePeriodParams(next, nextPeriod);
    startTransition(() => router.push(targetUrl(next), { scroll: false }));
  }

  function changeMode(mode: DashboardPeriodInput["mode"]) {
    if (mode === period.mode) {
      return;
    }
    navigate(defaultDashboardPeriod(mode));
  }

  const unavailable = isPending || requiresCanonicalization;
  const status =
    period.mode === "day"
      ? `Showing ${period.day}`
      : period.mode === "month"
        ? `Showing ${period.month}`
        : "Showing all time";

  return (
    <div
      className="period-filter"
      role="group"
      aria-label="Historical period"
      aria-busy={isPending}
    >
      <label className="period-filter__mode">
        <span>Range</span>
        <select
          aria-label="Time range"
          aria-disabled={unavailable}
          value={period.mode}
          onChange={(event) => changeMode(event.currentTarget.value as DashboardPeriodInput["mode"])}
        >
          <option value="all">All time</option>
          <option value="day">Day</option>
          <option value="month">Month</option>
        </select>
      </label>
      {period.mode === "day" ? (
        <label className="period-filter__value">
          <span className="sr-only">Filter day</span>
          <input
            type="date"
            min="0001-01-01"
            max="9999-12-31"
            aria-disabled={unavailable}
            value={period.day}
            onChange={(event) =>
              event.currentTarget.value &&
              navigate({ mode: "day", day: event.currentTarget.value })
            }
          />
        </label>
      ) : period.mode === "month" ? (
        <label className="period-filter__value">
          <span className="sr-only">Filter month</span>
          <input
            type="month"
            min="0001-01"
            max="9999-12"
            aria-disabled={unavailable}
            value={period.month}
            onChange={(event) =>
              event.currentTarget.value &&
              navigate({ mode: "month", month: event.currentTarget.value })
            }
          />
        </label>
      ) : null}
      <span className="sr-only" aria-live="polite">{isPending ? "Updating time range" : status}</span>
    </div>
  );
}
