import { describe, expect, it, type Mock, vi } from 'vitest';

import type { BudgetLine } from '@/notion/budget-lines';

import { ExtractionError } from './draft';
import {
  assertSupportedImage,
  type ExtractionContext,
  extractFromImage,
  extractFromText,
} from './extract';

const budgetLines: BudgetLine[] = [
  { id: 'line-coffee', name: "Coffee's and snacks", category: 'Food' },
  { id: 'line-sydney', name: 'Food Sydney', category: 'Food' },
  { id: 'line-melbourne', name: 'Melbourne Food', category: 'Food' },
];

/** 02:00 UTC is midday on the 17th in Melbourne. */
const now = () => new Date('2026-09-17T02:00:00Z');

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
      lineId: 'line-coffee',
      confidence: 'high',
      reason: 'The snack line fits',
      alternatives: [],
    },
    ...overrides,
  };
}

function setup(reply: unknown): { context: ExtractionContext; complete: Mock } {
  const complete = vi.fn().mockResolvedValue(reply);
  return {
    complete,
    context: {
      client: { complete },
      budgetLines,
      categories: ['Accomodation', 'Food', 'Activity', 'Tours'],
      currencies: ['EURO', 'AUD'],
      defaultCurrency: 'AUD',
      timezone: 'Australia/Melbourne',
      now,
    },
  };
}

describe('free-text extraction', () => {
  it('extracts a description and amount', async () => {
    const { context } = setup(response({ description: 'Coffee', amount: 8 }));

    const draft = await extractFromText('coffee 8 bucks', context);

    expect(draft.description).toBe('Coffee');
    expect(draft.amount).toBe(8);
  });

  it('uses the configured default currency when none is stated', async () => {
    const { context } = setup(response({ amount: 8, statedCurrency: null }));

    const draft = await extractFromText('coffee 8 bucks', context);

    expect(draft.currency).toBe('AUD');
    expect(draft.assumed.currency).toBe(true);
  });

  it('passes the typed text through to the model', async () => {
    const { context, complete } = setup(response());

    await extractFromText('43.20 groceries at woolies', context);

    expect(JSON.stringify(complete.mock.calls[0]?.[0])).toContain('43.20 groceries at woolies');
  });
});

describe('relative dates', () => {
  it('resolves against the trip timezone, not the server\u2019s', async () => {
    const { context } = setup(response({ date: '2026-09-16' }));

    const draft = await extractFromText('43.20 groceries at woolies yesterday', context);

    expect(draft.date).toBe('2026-09-16');
  });

  it('tells the model what today is, in the configured zone', async () => {
    // The model cannot resolve "yesterday" without being told the local date.
    const { context, complete } = setup(response());

    await extractFromText('anything', context);

    const system = (complete.mock.calls[0]?.[0] as { system: string }).system;
    expect(system).toContain('2026-09-17');
    expect(system).toContain('Australia/Melbourne');
  });
});

describe('currency resolution in the pipeline', () => {
  it('honours a currency the input states', async () => {
    const { context } = setup(
      response({ description: 'Camper deposit', amount: 200, statedCurrency: 'euro' }),
    );

    const draft = await extractFromText('camper deposit 200 euro', context);

    expect(draft.currency).toBe('EURO');
    expect(draft.assumed.currency).toBe(false);
    expect(draft.unsupportedCurrency).toBeNull();
  });

  it('falls back to the default and records an unsupported currency', async () => {
    const { context } = setup(response({ amount: 40, statedCurrency: 'USD' }));

    const draft = await extractFromText('museum 40 USD', context);

    expect(draft.currency).toBe('AUD');
    expect(draft.assumed.currency).toBe(true);
    expect(draft.unsupportedCurrency).toBe('USD');
  });
});

describe('an input with no amount', () => {
  it('produces no draft and says what to do', async () => {
    const { context } = setup(response({ description: 'Lunch', amount: null }));

    await expect(extractFromText('lunch somewhere nice', context)).rejects.toThrow(ExtractionError);

    await expect(extractFromText('lunch somewhere nice', context)).rejects.toMatchObject({
      failure: 'no-amount',
    });
  });

  it('asks the user to include an amount rather than reporting a generic failure', async () => {
    const { context } = setup(response({ description: 'Lunch', amount: null }));

    await expect(extractFromText('lunch somewhere nice', context)).rejects.toThrow(/amount/i);
  });
});

describe('an unreadable date', () => {
  it('defaults to today in the trip timezone and marks the field assumed', async () => {
    const { context } = setup(
      response({ date: null, assumed: { description: false, amount: false, date: true } }),
    );

    const draft = await extractFromText('coffee 8', context);

    expect(draft.date).toBe('2026-09-17');
    expect(draft.assumed.date).toBe(true);
  });

  it('uses the local date, so a late-evening spend lands on the right day', async () => {
    // 23:30 UTC on the 17th is already the 18th in Melbourne.
    const { context } = setup(response({ date: null }));

    const draft = await extractFromText('coffee 8', {
      ...context,
      now: () => new Date('2026-09-17T23:30:00Z'),
    });

    expect(draft.date).toBe('2026-09-18');
  });

  it('leaves an extracted date unflagged', async () => {
    const { context } = setup(
      response({ date: '2026-09-17', assumed: { description: false, amount: false, date: false } }),
    );

    const draft = await extractFromText('coffee 8', context);

    expect(draft.assumed.date).toBe(false);
  });
});

describe('budget line matching', () => {
  it('returns the chosen line with its confidence, reason and alternatives', async () => {
    const { context } = setup(
      response({
        description: 'Dinner in Sydney',
        match: {
          kind: 'existing',
          lineId: 'line-sydney',
          confidence: 'medium',
          reason: 'Sydney dining matches the Food Sydney line',
          alternatives: [{ lineId: 'line-melbourne', reason: 'Also a food line' }],
        },
      }),
    );

    const draft = await extractFromText('dinner in sydney 80', context);

    expect(draft.match).toEqual({
      kind: 'existing',
      lineId: 'line-sydney',
      lineName: 'Food Sydney',
      confidence: 'medium',
      reason: 'Sydney dining matches the Food Sydney line',
      alternatives: [{ lineId: 'line-melbourne', reason: 'Also a food line' }],
    });
  });

  it('keeps only alternatives that exist in the current budget', async () => {
    const { context } = setup(
      response({
        match: {
          kind: 'existing',
          lineId: 'line-sydney',
          confidence: 'high',
          reason: 'fits',
          alternatives: [
            { lineId: 'line-melbourne', reason: 'a real line' },
            { lineId: 'line-invented', reason: 'not a real line' },
          ],
        },
      }),
    );

    const draft = await extractFromText('dinner 80', context);

    expect(draft.match.kind === 'existing' && draft.match.alternatives).toEqual([
      { lineId: 'line-melbourne', reason: 'a real line' },
    ]);
  });

  it('refuses a match against a line the budget does not contain', async () => {
    // Matching is restricted to lines that exist, so this is not a match however
    // confident the model sounds.
    const { context } = setup(
      response({
        match: { kind: 'existing', lineId: 'line-invented', confidence: 'high', reason: 'fits' },
      }),
    );

    await expect(extractFromText('dinner 80', context)).rejects.toMatchObject({
      failure: 'unknown-budget-line',
    });
  });

  it('matches nothing when the budget is empty, and proposes instead', async () => {
    const { context } = setup(
      response({
        description: 'Coffee',
        match: { kind: 'proposed', name: 'Coffee', category: 'Food', reason: 'no lines exist' },
      }),
    );

    const draft = await extractFromText('coffee 8', { ...context, budgetLines: [] });

    expect(draft.match.kind).toBe('proposed');
  });
});

describe('proposing a new budget line', () => {
  it('returns a proposal with a configured category', async () => {
    const { context } = setup(
      response({
        description: 'Scuba diving course',
        amount: 320,
        match: {
          kind: 'proposed',
          name: 'Scuba diving',
          category: 'Activity',
          reason: 'No diving line exists',
        },
      }),
    );

    const draft = await extractFromText('scuba diving course 320', context);

    expect(draft.match).toEqual({
      kind: 'proposed',
      name: 'Scuba diving',
      category: 'Activity',
      reason: 'No diving line exists',
    });
  });

  it('refuses a category the budget does not have', async () => {
    // Writing an unconfigured option would fail against Notion's select, so it
    // is caught here rather than at write time.
    const { context } = setup(
      response({
        match: { kind: 'proposed', name: 'Scuba', category: 'Sports', reason: 'invented' },
      }),
    );

    await expect(extractFromText('scuba 320', context)).rejects.toMatchObject({
      failure: 'unknown-category',
    });
  });

  it('names the offending category in the failure', async () => {
    const { context } = setup(
      response({
        match: { kind: 'proposed', name: 'Scuba', category: 'Sports', reason: 'invented' },
      }),
    );

    await expect(extractFromText('scuba 320', context)).rejects.toThrow(/Sports/);
  });
});

describe('a malformed model response', () => {
  it('fails cleanly rather than patching the response into a draft', async () => {
    const { context } = setup({ description: 'Woolworths', amount: '43.20' });

    await expect(extractFromText('woolies 43.20', context)).rejects.toMatchObject({
      failure: 'invalid-response',
    });
  });

  it('fails on a response that is not JSON at all', async () => {
    const { context } = setup('Sorry, I could not read that receipt.');

    await expect(extractFromText('woolies 43.20', context)).rejects.toMatchObject({
      failure: 'invalid-response',
    });
  });

  it('fails when the response omits the match entirely', async () => {
    const { context } = setup({ description: 'Woolworths', amount: 43.2, date: '2026-09-17' });

    await expect(extractFromText('woolies 43.20', context)).rejects.toMatchObject({
      failure: 'invalid-response',
    });
  });

  it('adds no draft to anywhere when it fails', async () => {
    const { context } = setup(null);

    await expect(extractFromText('woolies 43.20', context)).rejects.toBeInstanceOf(ExtractionError);
  });
});

describe('receipt images', () => {
  it('rejects an unsupported format before any model call', async () => {
    const { context, complete } = setup(response());

    await expect(
      extractFromImage('data:application/pdf;base64,AAAA', context),
    ).rejects.toMatchObject({ failure: 'unsupported-format' });

    expect(complete).not.toHaveBeenCalled();
  });

  it('reports which formats are accepted', async () => {
    const { context } = setup(response());

    await expect(extractFromImage('data:application/pdf;base64,AAAA', context)).rejects.toThrow(
      /image\/jpeg/,
    );
  });

  it('accepts each supported format', () => {
    for (const type of ['image/jpeg', 'image/png', 'image/gif', 'image/webp']) {
      expect(() => assertSupportedImage(`data:${type};base64,AAAA`)).not.toThrow();
    }
  });

  it('rejects a string that is not a data URL', () => {
    expect(() => assertSupportedImage('https://example.com/receipt.jpg')).toThrow(ExtractionError);
  });

  it('sends the receipt as a data URL rather than a public address', async () => {
    const { context, complete } = setup(response());

    await extractFromImage('data:image/jpeg;base64,AAAA', context);

    const contents = JSON.stringify(complete.mock.calls[0]?.[0]);
    expect(contents).toContain('data:image/jpeg;base64,AAAA');
  });

  it('extracts a draft from a supported image', async () => {
    const { context } = setup(response({ description: 'Woolworths', amount: 43.2 }));

    const draft = await extractFromImage('data:image/jpeg;base64,AAAA', context);

    expect(draft.amount).toBe(43.2);
  });
});
