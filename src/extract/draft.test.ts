import { describe, expect, it } from 'vitest';

import { modelResponseSchema } from './draft';

function response(overrides: Record<string, unknown> = {}): unknown {
  return {
    description: 'Woolworths',
    amount: 43.2,
    statedCurrency: null,
    date: '2026-09-17',
    assumed: { description: false, amount: false, date: false },
    confidence: 'high',
    match: {
      kind: 'existing',
      lineId: 'line-1',
      confidence: 'high',
      reason: 'Food line fits',
      alternatives: [],
    },
    ...overrides,
  };
}

describe('the draft-expense schema', () => {
  it('accepts a well-formed response', () => {
    expect(modelResponseSchema.safeParse(response()).success).toBe(true);
  });

  it('accepts an amount of null, which means "no amount could be read"', () => {
    // A legitimate outcome, not a violation: the input simply had no amount.
    expect(modelResponseSchema.safeParse(response({ amount: null })).success).toBe(true);
  });

  it('accepts a date of null, which means "unreadable"', () => {
    expect(modelResponseSchema.safeParse(response({ date: null })).success).toBe(true);
  });

  it('rejects a missing description', () => {
    expect(modelResponseSchema.safeParse(response({ description: '' })).success).toBe(false);
    expect(modelResponseSchema.safeParse(response({ description: '   ' })).success).toBe(false);
    const { description, ...withoutDescription } = response() as Record<string, unknown>;
    expect(description).toBeDefined();
    expect(modelResponseSchema.safeParse(withoutDescription).success).toBe(false);
  });

  it('rejects an amount that is zero or negative', () => {
    // A zero total is not a reading, it is a misunderstanding of the request.
    expect(modelResponseSchema.safeParse(response({ amount: 0 })).success).toBe(false);
    expect(modelResponseSchema.safeParse(response({ amount: -5 })).success).toBe(false);
  });

  it('rejects an amount that is not a finite number', () => {
    expect(modelResponseSchema.safeParse(response({ amount: Number.NaN })).success).toBe(false);
    expect(
      modelResponseSchema.safeParse(response({ amount: Number.POSITIVE_INFINITY })).success,
    ).toBe(false);
    expect(modelResponseSchema.safeParse(response({ amount: '43.20' })).success).toBe(false);
  });

  it('rejects a date in a format the app cannot use', () => {
    expect(modelResponseSchema.safeParse(response({ date: '17/09/2026' })).success).toBe(false);
    expect(modelResponseSchema.safeParse(response({ date: 'yesterday' })).success).toBe(false);
    expect(modelResponseSchema.safeParse(response({ date: '2026-02-30' })).success).toBe(false);
  });

  it('rejects an unknown confidence', () => {
    expect(modelResponseSchema.safeParse(response({ confidence: 'certain' })).success).toBe(false);
  });

  it('requires an assumed flag for every field it reports on', () => {
    expect(
      modelResponseSchema.safeParse(response({ assumed: { description: false } })).success,
    ).toBe(false);
  });

  it('rejects a match that is neither an existing line nor a proposal', () => {
    expect(
      modelResponseSchema.safeParse(response({ match: { kind: 'guessed', lineId: 'line-1' } }))
        .success,
    ).toBe(false);
  });

  it('rejects an existing match with no line ID', () => {
    expect(
      modelResponseSchema.safeParse(
        response({
          match: { kind: 'existing', lineId: '', confidence: 'high', reason: 'fits' },
        }),
      ).success,
    ).toBe(false);
  });

  it('rejects a proposal with no category', () => {
    expect(
      modelResponseSchema.safeParse(
        response({ match: { kind: 'proposed', name: 'Scuba', category: '' } }),
      ).success,
    ).toBe(false);
  });

  it('accepts an existing match whose alternatives were omitted', () => {
    const { alternatives, ...matchWithoutAlternatives } = (
      response() as { match: Record<string, unknown> }
    ).match;
    expect(alternatives).toBeDefined();

    expect(
      modelResponseSchema.safeParse(response({ match: matchWithoutAlternatives })).success,
    ).toBe(true);
  });

  it('rejects a response that is not an object at all', () => {
    expect(modelResponseSchema.safeParse(null).success).toBe(false);
    expect(modelResponseSchema.safeParse('43.20 at Woolies').success).toBe(false);
    expect(modelResponseSchema.safeParse([]).success).toBe(false);
  });
});
