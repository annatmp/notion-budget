import { todayInTimezone } from '@/extract/time';

/**
 * A daily ceiling per identity on the capture endpoints.
 *
 * Authentication bounds *who* can call them; it does nothing to bound what they
 * cost. A looping client or a carelessly-shared session can burn the DeepSeek
 * balance without limit, and that failure is silent — it surfaces on a billing
 * page, not in the budget (design.md — "Spending limits on the model endpoints").
 *
 * The window is the local calendar day rather than a rolling 24 hours: a
 * ceiling that reset at an arbitrary hour mid-evening would be harder to explain
 * to someone who just hit it.
 */

export interface RateLimitResult {
  allowed: boolean;
  /** How many captures this identity has made today. */
  used: number;
  limit: number;
  /** The local day the count belongs to, `YYYY-MM-DD`. */
  day: string;
}

export interface DailyRateLimiterOptions {
  timezone: string;
  now?: () => Date;
  /** Where a refusal is recorded. Defaults to `console.warn`. */
  log?: (message: string) => void;
}

export class DailyRateLimiter {
  private readonly counters = new Map<string, { day: string; used: number }>();
  private readonly timezone: string;
  private readonly now: () => Date;
  private readonly log: (message: string) => void;

  constructor(
    private readonly limit: number,
    options: DailyRateLimiterOptions,
  ) {
    this.timezone = options.timezone;
    this.now = options.now ?? (() => new Date());
    this.log = options.log ?? ((message) => console.warn(message));
  }

  /**
   * Counts one capture against the identity and reports whether it may proceed.
   *
   * Counts the attempt even when refusing, so a client that keeps retrying can
   * never slip past by hammering the endpoint at the boundary.
   */
  consume(identity: string): RateLimitResult {
    const day = todayInTimezone(this.timezone, this.now());
    const entry = this.counters.get(identity);
    const carried = entry?.day === day ? entry.used : 0;
    const used = carried + 1;
    const allowed = used <= this.limit;

    this.counters.set(identity, { day, used });

    const result: RateLimitResult = { allowed, used, limit: this.limit, day };

    if (!allowed) {
      this.log(
        `Capture ceiling reached for ${identity}: ${used} attempts on ${day}, limit ${this.limit}.`,
      );
    }

    return result;
  }

  /**
   * What every identity has spent today, for somewhere visible to show it.
   * Stale days are dropped so the map cannot grow without bound.
   */
  snapshot(): Array<{ identity: string; used: number; limit: number }> {
    const day = todayInTimezone(this.timezone, this.now());

    for (const [identity, entry] of this.counters) {
      if (entry.day !== day) {
        this.counters.delete(identity);
      }
    }

    return [...this.counters].map(([identity, entry]) => ({
      identity,
      used: entry.used,
      limit: this.limit,
    }));
  }
}
