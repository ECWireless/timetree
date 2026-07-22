const MAX_DURATION_SECONDS = 2_147_483_647;

function decimalHoursToSeconds(value: string) {
  const [wholePart, fractionPart = ""] = value.split(".");
  const denominator = BigInt(10) ** BigInt(fractionPart.length);
  const numerator = BigInt(wholePart) * denominator + BigInt(fractionPart || "0");
  const scaled = numerator * BigInt(3_600);
  return Number((scaled + denominator / BigInt(2)) / denominator);
}

export function parseDuration(input: string): number | null {
  if (input.length > 64) {
    return null;
  }
  const match = /^\s*(?:(\d{1,10}(?:\.\d{1,6})?)\s*h)?\s*(?:(\d{1,10})\s*m)?\s*$/i.exec(
    input,
  );
  if (!match || (match[1] === undefined && match[2] === undefined)) {
    return null;
  }

  try {
    const hourSeconds = match[1] === undefined ? 0 : decimalHoursToSeconds(match[1]);
    const minuteSeconds =
      match[2] === undefined ? 0 : Number(BigInt(match[2]) * BigInt(60));
    const total = hourSeconds + minuteSeconds;
    return Number.isSafeInteger(total) && total > 0 && total <= MAX_DURATION_SECONDS
      ? total
      : null;
  } catch {
    return null;
  }
}

export function formatHistoricalDuration(durationSeconds: number) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0) {
    throw new RangeError("Duration must be a non-negative integer number of seconds.");
  }
  if (durationSeconds === 0) {
    return "0h";
  }
  if (durationSeconds < 60) {
    return "<1m";
  }

  const completedMinutes = Math.floor(durationSeconds / 60);
  const hours = Math.floor(completedMinutes / 60);
  const minutes = completedMinutes % 60;
  if (hours === 0) {
    return `${minutes}m`;
  }
  if (minutes === 0) {
    return `${hours}h`;
  }
  return `${hours}h ${minutes}m`;
}
