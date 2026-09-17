import { describe, expect, it } from 'vitest';

import { isIsoDate, todayInTimezone } from './time';

describe('the current date in the trip timezone', () => {
  it('gives the local date, not the UTC date', () => {
    // 23:30 UTC on the 17th is already the 18th in Melbourne (UTC+10).
    const lateEvening = new Date('2026-09-17T23:30:00Z');

    expect(todayInTimezone('Australia/Melbourne', lateEvening)).toBe('2026-09-18');
  });

  it('is wrong in the way a UTC implementation would be wrong', () => {
    // This is the failure the timezone config exists to prevent: a spend logged
    // late in the evening landing on the wrong day.
    const lateEvening = new Date('2026-09-17T23:30:00Z');

    expect(lateEvening.toISOString().slice(0, 10)).toBe('2026-09-17');
    expect(todayInTimezone('Australia/Melbourne', lateEvening)).not.toBe(
      lateEvening.toISOString().slice(0, 10),
    );
  });

  it('gives the previous day for an early-morning UTC instant', () => {
    // 01:00 UTC on the 18th is 11:00 on the 18th in Melbourne.
    expect(todayInTimezone('Australia/Melbourne', new Date('2026-09-18T01:00:00Z'))).toBe(
      '2026-09-18',
    );

    // 16:00 UTC on the 17th is 02:00 on the 18th in Melbourne.
    expect(todayInTimezone('Australia/Melbourne', new Date('2026-09-17T16:00:00Z'))).toBe(
      '2026-09-18',
    );

    // 13:00 UTC on the 17th is 23:00 on the 17th in Melbourne.
    expect(todayInTimezone('Australia/Melbourne', new Date('2026-09-17T13:00:00Z'))).toBe(
      '2026-09-17',
    );
  });

  it('always produces a sortable YYYY-MM-DD string', () => {
    const value = todayInTimezone('Australia/Melbourne', new Date('2026-01-05T00:00:00Z'));

    expect(value).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(value).toBe('2026-01-05');
  });

  it('follows the zone\u2019s daylight saving', () => {
    // Melbourne is UTC+11 during DST, so 12:30 UTC is 23:30 the same day.
    expect(todayInTimezone('Australia/Melbourne', new Date('2026-01-05T12:30:00Z'))).toBe(
      '2026-01-05',
    );
    // 13:30 UTC is 00:30 the next day.
    expect(todayInTimezone('Australia/Melbourne', new Date('2026-01-05T13:30:00Z'))).toBe(
      '2026-01-06',
    );
  });
});

describe('recognising an ISO date', () => {
  it('accepts real dates', () => {
    expect(isIsoDate('2026-09-17')).toBe(true);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2028-02-29')).toBe(true);
  });

  it('rejects dates that do not exist', () => {
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('2026-00-10')).toBe(false);
  });

  it('rejects other formats the model might return anyway', () => {
    expect(isIsoDate('17/09/2026')).toBe(false);
    expect(isIsoDate('2026-9-7')).toBe(false);
    expect(isIsoDate('2026-09-17T00:00:00Z')).toBe(false);
    expect(isIsoDate('yesterday')).toBe(false);
    expect(isIsoDate('')).toBe(false);
  });
});
