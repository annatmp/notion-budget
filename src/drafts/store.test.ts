import { describe, expect, it } from 'vitest';

import type { DraftExpense } from '@/extract/draft';

import { DraftStore } from './store';

function draft(overrides: Partial<DraftExpense> = {}): DraftExpense {
  return {
    description: 'Woolworths',
    amount: 43.2,
    currency: 'AUD',
    date: '2026-09-17',
    assumed: { description: false, amount: false, currency: true, date: false },
    confidence: 'high',
    unsupportedCurrency: null,
    match: {
      kind: 'existing',
      lineId: 'line-1',
      lineName: 'Food Roadtrip (week)',
      confidence: 'high',
      reason: 'Food line fits',
      alternatives: [],
    },
    ...overrides,
  };
}

/** A clock the test drives, so expiry is not a matter of waiting. */
function clock(start = 1_000_000) {
  let current = start;
  return {
    now: () => current,
    advance: (ms: number) => {
      current += ms;
    },
  };
}

describe('storing a draft', () => {
  it('stores and retrieves it by its client-generated id', () => {
    const store = new DraftStore();
    store.put('draft-1', draft());

    const found = store.get('draft-1');

    expect(found?.draft.description).toBe('Woolworths');
    expect(found?.draft.amount).toBe(43.2);
  });

  it('returns undefined for an unknown id', () => {
    expect(new DraftStore().get('never-existed')).toBeUndefined();
  });

  it('starts with neither identifier set', () => {
    const store = new DraftStore();
    store.put('draft-1', draft());

    const found = store.get('draft-1');

    expect(found?.createdBudgetLineId).toBeNull();
    expect(found?.writtenSpendingRowId).toBeNull();
  });

  it('keeps drafts apart', () => {
    const store = new DraftStore();
    store.put('draft-1', draft({ description: 'Woolworths' }));
    store.put('draft-2', draft({ description: 'Coffee' }));

    expect(store.get('draft-1')?.draft.description).toBe('Woolworths');
    expect(store.get('draft-2')?.draft.description).toBe('Coffee');
  });
});

describe('recording what has been written', () => {
  it('records the created budget line so a retry can reuse it', () => {
    const store = new DraftStore();
    store.put('draft-1', draft());

    store.update('draft-1', { createdBudgetLineId: 'line-new' });

    expect(store.get('draft-1')?.createdBudgetLineId).toBe('line-new');
  });

  it('records the written spending row so a confirm is not repeated', () => {
    const store = new DraftStore();
    store.put('draft-1', draft());

    store.update('draft-1', { writtenSpendingRowId: 'row-1' });

    expect(store.get('draft-1')?.writtenSpendingRowId).toBe('row-1');
  });

  it('replaces the draft when the user edits it', () => {
    const store = new DraftStore();
    store.put('draft-1', draft());

    store.update('draft-1', { draft: draft({ amount: 43.2, description: 'Woolies' }) });

    expect(store.get('draft-1')?.draft.description).toBe('Woolies');
  });

  it('leaves the other fields alone when patching one', () => {
    const store = new DraftStore();
    store.put('draft-1', draft());
    store.update('draft-1', { createdBudgetLineId: 'line-new' });

    store.update('draft-1', { writtenSpendingRowId: 'row-1' });

    expect(store.get('draft-1')?.createdBudgetLineId).toBe('line-new');
    expect(store.get('draft-1')?.writtenSpendingRowId).toBe('row-1');
  });

  it('reports an unknown id rather than creating one', () => {
    const store = new DraftStore();

    expect(store.update('never-existed', { writtenSpendingRowId: 'row-1' })).toBeUndefined();
    expect(store.get('never-existed')).toBeUndefined();
  });
});

describe('expiry', () => {
  it('returns a draft that is still within its time to live', () => {
    const time = clock();
    const store = new DraftStore(60_000, time.now);
    store.put('draft-1', draft());

    time.advance(59_000);

    expect(store.get('draft-1')).toBeDefined();
  });

  it('expires a draft once its time to live has passed', () => {
    const time = clock();
    const store = new DraftStore(60_000, time.now);
    store.put('draft-1', draft());

    time.advance(60_000);

    expect(store.get('draft-1')).toBeUndefined();
  });

  it('forgets an expired draft rather than holding it in memory', () => {
    const time = clock();
    const store = new DraftStore(60_000, time.now);
    store.put('draft-1', draft());
    time.advance(60_000);
    store.get('draft-1');

    expect(store.size).toBe(0);
  });

  it('purges expired drafts when a new one arrives', () => {
    const time = clock();
    const store = new DraftStore(60_000, time.now);
    store.put('old', draft());
    time.advance(60_000);

    store.put('new', draft());

    expect(store.get('old')).toBeUndefined();
    expect(store.size).toBe(1);
  });
});

describe('discarding', () => {
  it('removes the draft', () => {
    const store = new DraftStore();
    store.put('draft-1', draft());

    expect(store.delete('draft-1')).toBe(true);
    expect(store.get('draft-1')).toBeUndefined();
  });

  it('reports whether there was anything to remove', () => {
    expect(new DraftStore().delete('never-existed')).toBe(false);
  });
});
