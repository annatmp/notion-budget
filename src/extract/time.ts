const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** Whether a string is a real calendar date in `YYYY-MM-DD` form. */
export function isIsoDate(value: string): boolean {
  if (!ISO_DATE.test(value)) {
    return false;
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

/**
 * Today's date in the configured zone, as `YYYY-MM-DD`.
 *
 * This is why the timezone is configuration: a spend logged at 9pm in Melbourne
 * is still "today" locally but already tomorrow in UTC, so resolving the date
 * against UTC would put the spend on the wrong day (`design.md` — "Trip timezone
 * is configuration").
 */
export function todayInTimezone(timezone: string, now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((candidate) => candidate.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')}`;
}
