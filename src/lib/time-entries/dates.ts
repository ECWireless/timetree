export function isValidWorkDate(value: string) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) {
    return false;
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function pad(value: number) {
  return value.toString().padStart(2, "0");
}

export function toLocalWorkDate(date: Date) {
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function toLocalDateTimeInput(date: Date, includeSeconds = false) {
  const seconds = includeSeconds ? `:${pad(date.getSeconds())}` : "";
  return `${toLocalWorkDate(date)}T${pad(date.getHours())}:${pad(date.getMinutes())}${seconds}`;
}

export type LocalDateTimeCandidate = {
  iso: string;
  offsetMinutes: number;
};

function normalizeLocalDateTime(value: string) {
  return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value) ? `${value}:00` : value;
}

function offsetSuffix(offsetMinutes: number) {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteOffset = Math.abs(offsetMinutes);
  return `${sign}${pad(Math.floor(absoluteOffset / 60))}:${pad(absoluteOffset % 60)}`;
}

export function formatUtcOffset(offsetMinutes: number) {
  return `UTC${offsetSuffix(offsetMinutes)}`;
}

export function getLocalDateTimeCandidates(value: string): LocalDateTimeCandidate[] {
  const normalized = normalizeLocalDateTime(value);
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(normalized);
  if (!match) {
    return [];
  }
  const [, year, month, day, hour, minute, second] = match;
  const naiveUtc = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  const possibleOffsets = new Set<number>();
  for (let probeHour = -15; probeHour <= 15; probeHour += 1) {
    possibleOffsets.add(-new Date(naiveUtc + probeHour * 3_600_000).getTimezoneOffset());
  }

  return [...possibleOffsets]
    .map((offsetMinutes) => ({
      iso: `${normalized}${offsetSuffix(offsetMinutes)}`,
      offsetMinutes,
    }))
    .filter(({ iso }) => toLocalDateTimeInput(new Date(iso), true) === normalized)
    .sort((left, right) => new Date(left.iso).getTime() - new Date(right.iso).getTime());
}

type ResolveRangeInput = {
  startedAtInput: string;
  endedAtInput: string;
  startOffsetMinutes: number | null;
  endOffsetMinutes: number | null;
  initialStartedAtInput?: string;
  initialEndedAtInput?: string;
  storedStartedAt?: string;
  storedEndedAt?: string;
  storedWorkDate?: string;
};

export type ResolvedRangeInput =
  | {
      ok: true;
      startedAt: string;
      endedAt: string;
      workDate: string;
      preserveStart: boolean;
      preserveEnd: boolean;
    }
  | { ok: false; fieldErrors: Record<string, string[]> };

type LocalDateTimeResolution = { iso: string } | { error: string };

function resolveChangedLocalDateTime(
  value: string,
  selectedOffset: number | null,
): LocalDateTimeResolution {
  const candidates = getLocalDateTimeCandidates(value);
  if (candidates.length === 0) {
    return { error: "Choose a local time that exists in your timezone." };
  }
  if (candidates.length > 1 && selectedOffset === null) {
    return { error: "Choose which occurrence of this repeated local time you mean." };
  }
  const selected =
    candidates.length === 1
      ? candidates[0]
      : candidates.find(({ offsetMinutes }) => offsetMinutes === selectedOffset);
  return selected
    ? { iso: selected.iso }
    : { error: "Choose a valid UTC offset for this local time." };
}

export function resolveRangeInput(input: ResolveRangeInput): ResolvedRangeInput {
  const preserveStart =
    input.storedStartedAt !== undefined &&
    input.initialStartedAtInput === input.startedAtInput;
  const preserveEnd =
    input.storedEndedAt !== undefined && input.initialEndedAtInput === input.endedAtInput;
  const resolvedStart: LocalDateTimeResolution = preserveStart
    ? { iso: input.storedStartedAt! }
    : resolveChangedLocalDateTime(input.startedAtInput, input.startOffsetMinutes);
  const resolvedEnd: LocalDateTimeResolution = preserveEnd
    ? { iso: input.storedEndedAt! }
    : resolveChangedLocalDateTime(input.endedAtInput, input.endOffsetMinutes);
  if ("error" in resolvedStart || "error" in resolvedEnd) {
    const fieldErrors: Record<string, string[]> = {};
    if ("error" in resolvedStart) {
      fieldErrors.startedAt = [resolvedStart.error];
    }
    if ("error" in resolvedEnd) {
      fieldErrors.endedAt = [resolvedEnd.error];
    }
    return { ok: false, fieldErrors };
  }

  return {
    ok: true,
    startedAt: resolvedStart.iso,
    endedAt: resolvedEnd.iso,
    preserveStart,
    preserveEnd,
    workDate:
      preserveStart && input.storedWorkDate !== undefined
        ? input.storedWorkDate
        : input.startedAtInput.slice(0, 10),
  };
}
