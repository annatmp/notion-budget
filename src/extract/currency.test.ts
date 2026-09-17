import { describe, expect, it } from 'vitest';

import { resolveCurrency } from './currency';

const budget = { currencies: ['EURO', 'AUD'], defaultCurrency: 'AUD' };

describe('resolving a stated currency onto the budget\u2019s options', () => {
  it('matches a configured currency exactly', () => {
    expect(resolveCurrency('EURO', budget)).toEqual({ currency: 'EURO', assumed: false });
    expect(resolveCurrency('AUD', budget)).toEqual({ currency: 'AUD', assumed: false });
  });

  it('matches a configured currency case-insensitively', () => {
    // "200 euro" must land on EURO, not on the default.
    expect(resolveCurrency('euro', budget)).toEqual({ currency: 'EURO', assumed: false });
    expect(resolveCurrency('Euro', budget)).toEqual({ currency: 'EURO', assumed: false });
    expect(resolveCurrency('aud', budget)).toEqual({ currency: 'AUD', assumed: false });
  });

  it('reads the euro symbol', () => {
    expect(resolveCurrency('€', budget)).toEqual({ currency: 'EURO', assumed: false });
  });

  it('trims surrounding whitespace', () => {
    expect(resolveCurrency('  EURO  ', budget)).toEqual({ currency: 'EURO', assumed: false });
  });

  it('falls back to the default and records the statement when unsupported', () => {
    const result = resolveCurrency('USD', budget);

    expect(result.currency).toBe('AUD');
    expect(result.assumed).toBe(true);
    expect(result.unsupported).toBe('USD');
  });

  it('falls back to the default when the input stated nothing at all', () => {
    expect(resolveCurrency(null, budget)).toEqual({ currency: 'AUD', assumed: true });
    expect(resolveCurrency('', budget)).toEqual({ currency: 'AUD', assumed: true });
    expect(resolveCurrency('   ', budget)).toEqual({ currency: 'AUD', assumed: true });
  });

  it('does not guess at an ambiguous symbol', () => {
    // `$` is AUD, USD and several others. Guessing would silently mislabel a
    // receipt, so it falls through and review gets told.
    const result = resolveCurrency('$', budget);

    expect(result.currency).toBe('AUD');
    expect(result.assumed).toBe(true);
    expect(result.unsupported).toBe('$');
  });

  it('always returns one of the configured options', () => {
    for (const stated of ['EURO', 'AUD', 'USD', 'GBP', '¥', null, 'nonsense']) {
      expect(budget.currencies).toContain(resolveCurrency(stated, budget).currency);
    }
  });

  it('follows the configuration when a budget uses different options', () => {
    const other = { currencies: ['GBP', 'USD'], defaultCurrency: 'GBP' };

    expect(resolveCurrency('USD', other)).toEqual({ currency: 'USD', assumed: false });
    expect(resolveCurrency('EURO', other)).toEqual({
      currency: 'GBP',
      assumed: true,
      unsupported: 'EURO',
    });
  });
});
