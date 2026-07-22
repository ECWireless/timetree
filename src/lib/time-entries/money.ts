const MAX_RATE_CENTS = 2_147_483_647;

const usd = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
});

export function parseRateCents(input: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(input.trim());
  if (!match) {
    return null;
  }

  const cents = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  return Number.isSafeInteger(cents) && cents <= MAX_RATE_CENTS ? cents : null;
}

export function formatUsd(cents: number) {
  return usd.format(cents / 100);
}

export function formatRate(cents: number) {
  return `${formatUsd(cents)}/hr`;
}

export function calculateRoundedValueCents(durationSeconds: number, hourlyRateCents: number) {
  if (!Number.isInteger(durationSeconds) || durationSeconds < 0) {
    throw new RangeError("Duration must be a non-negative integer number of seconds.");
  }
  if (!Number.isInteger(hourlyRateCents) || hourlyRateCents < 0) {
    throw new RangeError("Rate must be a non-negative integer number of cents.");
  }

  const numerator = BigInt(durationSeconds) * BigInt(hourlyRateCents);
  const rounded = (numerator + BigInt(1_800)) / BigInt(3_600);
  const result = Number(rounded);
  if (!Number.isSafeInteger(result)) {
    throw new RangeError("Calculated value exceeds the supported display range.");
  }
  return result;
}
