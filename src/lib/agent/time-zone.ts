const maximumTimeZoneLength = 100;

export function isValidIanaTimeZone(value: string) {
  if (
    value.length === 0 ||
    value.length > maximumTimeZoneLength ||
    value.trim() !== value ||
    !/^[A-Za-z]/.test(value)
  ) {
    return false;
  }

  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

export function getWorkDateInTimeZone(timestamp: Date, timeZone: string) {
  if (!isValidIanaTimeZone(timeZone)) {
    throw new RangeError("Invalid IANA time zone.");
  }

  const parts = new Intl.DateTimeFormat("en-US", {
    calendar: "iso8601",
    numberingSystem: "latn",
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(timestamp);
  const byType = new Map(parts.map((part) => [part.type, part.value]));
  const year = byType.get("year");
  const month = byType.get("month");
  const day = byType.get("day");
  if (!year || !month || !day) {
    throw new RangeError("Unable to derive a work date.");
  }
  return `${year}-${month}-${day}`;
}
