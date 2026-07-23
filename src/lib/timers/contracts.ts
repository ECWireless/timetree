import type { TimeEntryRecord } from "@/lib/time-entries/contracts";

export type ActiveTimerRecord = {
  id: string;
  nodeId: string;
  startedAt: string;
  workDate: string;
  hourlyRateCents: number | null;
};

export type StartTimerInput = {
  nodeId: string;
  workDate: string;
};

export type StopTimerInput = {
  timerId: string;
};

export type TimerActionResult =
  | { ok: true; timer: ActiveTimerRecord }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

export type StopTimerActionResult =
  | { ok: true; timerId: string; entry: TimeEntryRecord }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };
