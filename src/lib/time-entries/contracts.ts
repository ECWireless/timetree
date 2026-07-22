export type TimeEntryMode = "duration" | "range";

type TimeEntryCommonInput = {
  nodeId: string;
  notes?: string | null;
  hourlyRateCents?: number | null;
};

export type CreateTimeEntryInput = TimeEntryCommonInput &
  (
    | {
        mode: "duration";
        workDate: string;
        duration: string;
      }
    | {
        mode: "range";
        workDate: string;
        startedAt: string;
        endedAt: string;
      }
  );

export type UpdateTimeEntryInput = TimeEntryCommonInput &
  (
    | {
        id: string;
        mode: "duration";
        workDate: string;
        duration: string;
      }
    | {
        id: string;
        mode: "range";
        start:
          | { kind: "preserve" }
          | { kind: "replace"; value: string; workDate: string };
        end: { kind: "preserve" } | { kind: "replace"; value: string };
      }
  );

export type DeleteTimeEntryInput = {
  id: string;
};

export type TimeEntryCursor = {
  createdAt: string;
  id: string;
};

export type TimeEntryRecord = {
  id: string;
  nodeId: string;
  workDate: string;
  startedAt: string | null;
  endedAt: string | null;
  durationSeconds: number;
  hourlyRateCents: number | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
};

export type TimeEntryPage = {
  entries: TimeEntryRecord[];
  nextCursor: TimeEntryCursor | null;
};

export type TimeEntryActionResult =
  | { ok: true; entry: TimeEntryRecord }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

export type DeleteTimeEntryActionResult =
  | { ok: true; entryId: string }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };

export type LoadTimeEntriesActionResult =
  | { ok: true; page: TimeEntryPage }
  | {
      ok: false;
      message: string;
      fieldErrors?: Record<string, string[]>;
    };
