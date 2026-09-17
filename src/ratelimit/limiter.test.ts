import { describe, expect, it, vi } from 'vitest';

import { DailyRateLimiter } from './limiter';

const TIMEZONE = 'Australia/Melbourne';

function limiter(limit: number, at = () => new Date('2026-09-17T02:00:00Z')) {
  const log = vi.fn();
  return { limiter: new DailyRateLimiter(limit, { timezone: TIMEZONE, now: at, log }), log };
}

describe('the daily capture ceiling', () => {
  it('allows captures well below the ceiling', () => {
    const { limiter: limiterInstance } = limiter(200);

    const result = limiterInstance.consume('anna@example.com');

    expect(result.allowed).toBe(true);
    expect(result.used).toBe(1);
    expect(result.limit).toBe(200);
  });

  it('allows the capture that reaches the ceiling exactly', () => {
    const { limiter: limiterInstance } = limiter(3);

    limiterInstance.consume('a');
    limiterInstance.consume('a');

    expect(limiterInstance.consume('a')).toMatchObject({ allowed: true, used: 3 });
  });

  it('refuses the capture beyond the ceiling', () => {
    const { limiter: limiterInstance } = limiter(3);

    limiterInstance.consume('a');
    limiterInstance.consume('a');
    limiterInstance.consume('a');

    expect(limiterInstance.consume('a')).toMatchObject({ allowed: false, used: 4 });
  });

  it('keeps refusing however many times it is retried', () => {
    const { limiter: limiterInstance } = limiter(2);

    limiterInstance.consume('a');
    limiterInstance.consume('a');

    expect(limiterInstance.consume('a').allowed).toBe(false);
    expect(limiterInstance.consume('a').allowed).toBe(false);
  });

  it('counts each identity separately', () => {
    const { limiter: limiterInstance } = limiter(2);

    limiterInstance.consume('anna@example.com');
    limiterInstance.consume('anna@example.com');

    // The partner's ceiling is her own; one person hitting it must not lock the
    // other out mid-trip.
    expect(limiterInstance.consume('sam@example.com')).toMatchObject({ allowed: true, used: 1 });
  });
});

describe('the window', () => {
  it('reports which local day the count belongs to', () => {
    const { limiter: limiterInstance } = limiter(10);

    expect(limiterInstance.consume('a').day).toBe('2026-09-17');
  });

  it('resets when the local day rolls over', () => {
    let instant = new Date('2026-09-17T02:00:00Z');
    const { limiter: limiterInstance } = limiter(1, () => instant);

    expect(limiterInstance.consume('a').allowed).toBe(true);
    expect(limiterInstance.consume('a').allowed).toBe(false);

    // 14:00 UTC is midnight in Melbourne, so it is now the 18th.
    instant = new Date('2026-09-17T14:00:00Z');

    expect(limiterInstance.consume('a')).toMatchObject({
      allowed: true,
      used: 1,
      day: '2026-09-18',
    });
  });

  it('rolls over on the trip\u2019s day, not the server\u2019s', () => {
    // 23:30 UTC on the 17th is already the 18th in Melbourne. A UTC-day window
    // would give the ceiling back five hours early.
    const { limiter: limiterInstance } = limiter(1, () => new Date('2026-09-17T23:30:00Z'));

    expect(limiterInstance.consume('a').day).toBe('2026-09-18');
  });
});

describe('a refusal is recorded', () => {
  it('logs the identity, the count and the ceiling', () => {
    const { limiter: limiterInstance, log } = limiter(1);

    limiterInstance.consume('anna@example.com');
    limiterInstance.consume('anna@example.com');

    expect(log).toHaveBeenCalledTimes(1);
    expect(log.mock.calls[0]?.[0]).toContain('anna@example.com');
    expect(log.mock.calls[0]?.[0]).toContain('2026-09-17');
  });

  it('does not log an ordinary capture', () => {
    const { limiter: limiterInstance, log } = limiter(10);

    limiterInstance.consume('a');

    expect(log).not.toHaveBeenCalled();
  });
});

describe('the snapshot', () => {
  it('shows what each identity has spent today', () => {
    const { limiter: limiterInstance } = limiter(10);

    limiterInstance.consume('anna@example.com');
    limiterInstance.consume('anna@example.com');
    limiterInstance.consume('sam@example.com');

    expect(limiterInstance.snapshot()).toEqual([
      { identity: 'anna@example.com', used: 2, limit: 10 },
      { identity: 'sam@example.com', used: 1, limit: 10 },
    ]);
  });

  it('drops counters from a previous day rather than growing without bound', () => {
    let instant = new Date('2026-09-17T02:00:00Z');
    const { limiter: limiterInstance } = limiter(10, () => instant);
    limiterInstance.consume('a');

    instant = new Date('2026-09-20T02:00:00Z');

    expect(limiterInstance.snapshot()).toEqual([]);
  });
});
