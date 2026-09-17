import { describe, expect, it, vi } from 'vitest';

import type { DraftExpense, ExtractionError } from '@/extract/draft';
import type { BudgetLine } from '@/notion/budget-lines';

import { ConfirmError, DraftService, InvalidDraftEditError, UnknownDraftError } from './service';
import { DraftStore } from './store';

const budgetLines: BudgetLine[] = [
  { id: 'line-coffee', name: "Coffee's and snacks", category: 'Food' },
  { id: 'line-sydney', name: 'Food Sydney', category: 'Food' },
];

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
      lineId: 'line-coffee',
      lineName: "Coffee's and snacks",
      confidence: 'high',
      reason: 'Snacks line fits',
      alternatives: [],
    },
    ...overrides,
  };
}

interface SetupOptions {
  draft?: Partial<DraftExpense>;
  extractionFails?: Error;
}

function setup(options: SetupOptions = {}) {
  const order: string[] = [];
  const store = new DraftStore();
  const captured = draft(options.draft);

  const readBudgetLines = vi.fn(async () => budgetLines);
  const createBudgetLine = vi.fn(async (input: { name: string; category: string }) => {
    order.push('budget-line');
    return { id: 'line-new', name: input.name, category: input.category };
  });
  const createSpendingRow = vi.fn(async () => {
    order.push('spending-row');
    return { id: 'row-1' };
  });
  const complete = vi.fn();

  const runTextExtraction = vi.fn(async () => {
    if (options.extractionFails !== undefined) {
      throw options.extractionFails;
    }
    return captured;
  });

  const service = new DraftService({
    store,
    readBudgetLines,
    createBudgetLine,
    createSpendingRow,
    extraction: {
      client: { complete },
      categories: ['Food', 'Activity', 'Tours'],
      currencies: ['EURO', 'AUD'],
      defaultCurrency: 'AUD',
      timezone: 'Australia/Melbourne',
      now: () => new Date('2026-09-17T02:00:00Z'),
    },
    runTextExtraction,
    runImageExtraction: vi.fn(async () => captured),
  });

  return {
    service,
    store,
    order,
    complete,
    readBudgetLines,
    createBudgetLine,
    createSpendingRow,
    runTextExtraction,
  };
}

describe('capture writes nothing', () => {
  it('returns a draft for review and never reaches a Notion writer', async () => {
    const { service, createSpendingRow, createBudgetLine } = setup();

    const record = await service.captureFromText({ text: 'woolies 43.20' });

    expect(record.draft.amount).toBe(43.2);
    expect(createSpendingRow).not.toHaveBeenCalled();
    expect(createBudgetLine).not.toHaveBeenCalled();
  });

  it('holds the draft so it can be reviewed afterwards', async () => {
    const { service } = setup();

    const record = await service.captureFromText({ text: 'woolies 43.20' });

    expect(service.get(record.id).draft.description).toBe('Woolworths');
    expect(record.createdBudgetLineId).toBeNull();
    expect(record.writtenSpendingRowId).toBeNull();
  });

  it('uses the id the client supplied, so a repeated capture is recognisable', async () => {
    const { service } = setup();

    const record = await service.captureFromText({ text: 'woolies', draftId: 'client-draft-1' });

    expect(record.id).toBe('client-draft-1');
    expect(service.get('client-draft-1')).toBeDefined();
  });

  it('stores no draft at all when extraction fails', async () => {
    const failure = new Error('No amount could be read from that input.') as ExtractionError;
    const { service, store, createSpendingRow } = setup({ extractionFails: failure });

    await expect(service.captureFromText({ text: 'lunch somewhere nice' })).rejects.toThrow();

    expect(store.size).toBe(0);
    expect(createSpendingRow).not.toHaveBeenCalled();
  });
});

describe('editing a draft', () => {
  it('changes the field the user changed', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies 43.20' });

    const edited = await service.edit(id, { amount: 43.2 });

    expect(edited.draft.amount).toBe(43.2);
  });

  it('leaves the other fields exactly as they were', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies 43.20' });

    const edited = await service.edit(id, { amount: 34.2 });

    expect(edited.draft.description).toBe('Woolworths');
    expect(edited.draft.currency).toBe('AUD');
    expect(edited.draft.date).toBe('2026-09-17');
    expect(edited.draft.match).toEqual(draft().match);
  });

  it('does not re-run extraction', async () => {
    const { service, runTextExtraction, complete } = setup();
    const { id } = await service.captureFromText({ text: 'woolies 43.20' });

    await service.edit(id, { description: 'Woolworths Metro' });

    expect(runTextExtraction).toHaveBeenCalledTimes(1);
    expect(complete).not.toHaveBeenCalled();
  });

  it('writes nothing', async () => {
    const { service, createSpendingRow, createBudgetLine } = setup();
    const { id } = await service.captureFromText({ text: 'woolies 43.20' });

    await service.edit(id, { amount: 34.2, description: 'Woolies' });

    expect(createSpendingRow).not.toHaveBeenCalled();
    expect(createBudgetLine).not.toHaveBeenCalled();
  });

  it('refuses an amount that is not greater than zero', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    await expect(service.edit(id, { amount: 0 })).rejects.toBeInstanceOf(InvalidDraftEditError);
    await expect(service.edit(id, { amount: -1 })).rejects.toBeInstanceOf(InvalidDraftEditError);
  });

  it('refuses an empty description', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    await expect(service.edit(id, { description: '   ' })).rejects.toBeInstanceOf(
      InvalidDraftEditError,
    );
  });

  it('refuses a currency the budget does not use', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    await expect(service.edit(id, { currency: 'USD' })).rejects.toBeInstanceOf(
      InvalidDraftEditError,
    );
  });

  it('clears the assumed flag when the user confirms a currency', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    const edited = await service.edit(id, { currency: 'EURO' });

    expect(edited.draft.assumed.currency).toBe(false);
    expect(edited.draft.unsupportedCurrency).toBeNull();
  });

  it('refuses a date that is not a real date', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    await expect(service.edit(id, { date: '17/09/2026' })).rejects.toBeInstanceOf(
      InvalidDraftEditError,
    );
    await expect(service.edit(id, { date: '2026-02-30' })).rejects.toBeInstanceOf(
      InvalidDraftEditError,
    );
  });

  it('clears the assumed flag when the user sets a date', async () => {
    const { service } = setup({
      draft: { assumed: { description: false, amount: false, currency: true, date: true } },
    });
    const { id } = await service.captureFromText({ text: 'woolies' });

    const edited = await service.edit(id, { date: '2026-09-16' });

    expect(edited.draft.assumed.date).toBe(false);
  });

  it('accepts a budget line the user picks instead', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    const edited = await service.edit(id, {
      match: {
        kind: 'existing',
        lineId: 'line-sydney',
        lineName: '',
        confidence: 'high',
        reason: 'chosen by the user',
        alternatives: [],
      },
    });

    expect(edited.draft.match).toMatchObject({ lineId: 'line-sydney', lineName: 'Food Sydney' });
  });

  it('refuses a budget line that is no longer in the budget', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    await expect(
      service.edit(id, {
        match: {
          kind: 'existing',
          lineId: 'line-deleted',
          lineName: '',
          confidence: 'high',
          reason: 'stale',
          alternatives: [],
        },
      }),
    ).rejects.toBeInstanceOf(InvalidDraftEditError);
  });

  it('refuses a proposal with a category the budget does not have', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    await expect(
      service.edit(id, {
        match: { kind: 'proposed', name: 'Scuba', category: 'Sports', reason: 'invented' },
      }),
    ).rejects.toBeInstanceOf(InvalidDraftEditError);
  });

  it('reports an unknown draft rather than inventing one', async () => {
    const { service } = setup();

    await expect(service.edit('never-existed', { amount: 5 })).rejects.toBeInstanceOf(
      UnknownDraftError,
    );
  });
});

describe('confirming', () => {
  it('writes the values the user edited', async () => {
    const { service, createSpendingRow } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });
    await service.edit(id, { amount: 34.2, description: 'Woolworths Metro' });

    await service.confirm(id);

    expect(createSpendingRow).toHaveBeenCalledWith(
      expect.objectContaining({
        amount: 34.2,
        description: 'Woolworths Metro',
        currency: 'AUD',
        date: '2026-09-17',
        budgetLineId: 'line-coffee',
      }),
    );
  });

  it('creates an accepted budget line first, then relates the row to it', async () => {
    const { service, order, createSpendingRow } = setup({
      draft: {
        match: {
          kind: 'proposed',
          name: 'Scuba diving',
          category: 'Activity',
          reason: 'nothing fits',
        },
      },
    });
    const { id } = await service.captureFromText({ text: 'scuba 320' });

    await service.confirm(id);

    expect(order).toEqual(['budget-line', 'spending-row']);
    expect(createSpendingRow).toHaveBeenCalledWith(
      expect.objectContaining({ budgetLineId: 'line-new' }),
    );
  });

  it('creates no budget line when an existing one was matched', async () => {
    const { service, createBudgetLine } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    await service.confirm(id);

    expect(createBudgetLine).not.toHaveBeenCalled();
  });

  it('reports what was written, naming the line and the amount', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    const result = await service.confirm(id);

    expect(result).toEqual({
      spendingRowId: 'row-1',
      budgetLineId: 'line-coffee',
      budgetLineName: "Coffee's and snacks",
      amount: 43.2,
      currency: 'AUD',
      createdBudgetLine: false,
      written: true,
    });
  });

  it('reports a created line as created', async () => {
    const { service } = setup({
      draft: {
        match: {
          kind: 'proposed',
          name: 'Scuba diving',
          category: 'Activity',
          reason: 'fits none',
        },
      },
    });
    const { id } = await service.captureFromText({ text: 'scuba 320' });

    const result = await service.confirm(id);

    expect(result.createdBudgetLine).toBe(true);
    expect(result.budgetLineName).toBe('Scuba diving');
    expect(result.budgetLineId).toBe('line-new');
  });

  it('reports an unknown draft rather than writing anything', async () => {
    const { service, createSpendingRow } = setup();

    await expect(service.confirm('never-existed')).rejects.toBeInstanceOf(UnknownDraftError);
    expect(createSpendingRow).not.toHaveBeenCalled();
  });
});

describe('retrying a confirmation', () => {
  it('returns the row already written instead of writing a second one', async () => {
    const { service, createSpendingRow } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    const first = await service.confirm(id);
    const second = await service.confirm(id);

    expect(createSpendingRow).toHaveBeenCalledTimes(1);
    expect(second.spendingRowId).toBe(first.spendingRowId);
    expect(second.written).toBe(false);
  });

  it('does not create a second budget line when retrying a partial failure', async () => {
    const { service, createBudgetLine, createSpendingRow } = setup({
      draft: {
        match: {
          kind: 'proposed',
          name: 'Scuba diving',
          category: 'Activity',
          reason: 'fits none',
        },
      },
    });
    const { id } = await service.captureFromText({ text: 'scuba 320' });

    createSpendingRow.mockRejectedValueOnce(new Error('Notion is down'));
    await expect(service.confirm(id)).rejects.toBeInstanceOf(ConfirmError);

    const result = await service.confirm(id);

    expect(createBudgetLine).toHaveBeenCalledTimes(1);
    expect(createSpendingRow).toHaveBeenCalledTimes(2);
    expect(result.budgetLineId).toBe('line-new');
    expect(result.spendingRowId).toBe('row-1');
  });

  it('results in exactly one row and one line after a retry', async () => {
    const { service, createBudgetLine, createSpendingRow } = setup({
      draft: {
        match: {
          kind: 'proposed',
          name: 'Scuba diving',
          category: 'Activity',
          reason: 'fits none',
        },
      },
    });
    const { id } = await service.captureFromText({ text: 'scuba 320' });

    createSpendingRow.mockRejectedValueOnce(new Error('Notion is down'));
    await service.confirm(id).catch(() => undefined);
    await service.confirm(id);

    expect(createBudgetLine).toHaveBeenCalledTimes(1);
    expect(createSpendingRow).toHaveBeenCalledTimes(2);
  });
});

describe('reporting a failed write', () => {
  it('keeps the draft, with the user\u2019s edits intact', async () => {
    const { service, createSpendingRow } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });
    await service.edit(id, { amount: 34.2, description: 'Woolworths Metro' });

    createSpendingRow.mockRejectedValueOnce(new Error('Notion is down'));
    await expect(service.confirm(id)).rejects.toBeInstanceOf(ConfirmError);

    const preserved = service.get(id);
    expect(preserved.draft.amount).toBe(34.2);
    expect(preserved.draft.description).toBe('Woolworths Metro');
    expect(preserved.writtenSpendingRowId).toBeNull();
  });

  it('says the line was created when only the row write failed', async () => {
    const { service, createSpendingRow } = setup({
      draft: {
        match: {
          kind: 'proposed',
          name: 'Scuba diving',
          category: 'Activity',
          reason: 'fits none',
        },
      },
    });
    const { id } = await service.captureFromText({ text: 'scuba 320' });

    createSpendingRow.mockRejectedValueOnce(new Error('Notion is down'));

    let error: ConfirmError | undefined;
    await service.confirm(id).catch((cause: unknown) => {
      error = cause as ConfirmError;
    });

    expect(error).toBeInstanceOf(ConfirmError);
    expect(error?.budgetLineCreated).toBe(true);
    expect(error?.message).toMatch(/budget line was created/i);
  });

  it('says nothing was created when the line could not be created', async () => {
    const { service, createBudgetLine, createSpendingRow } = setup({
      draft: {
        match: {
          kind: 'proposed',
          name: 'Scuba diving',
          category: 'Activity',
          reason: 'fits none',
        },
      },
    });
    const { id } = await service.captureFromText({ text: 'scuba 320' });

    createBudgetLine.mockRejectedValueOnce(new Error('Notion is down'));

    await expect(service.confirm(id)).rejects.toMatchObject({ budgetLineCreated: false });
    expect(createSpendingRow).not.toHaveBeenCalled();
  });

  it('does not mark the draft written when the write failed', async () => {
    const { service, store, createSpendingRow } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    createSpendingRow.mockRejectedValueOnce(new Error('Notion is down'));
    await expect(service.confirm(id)).rejects.toBeInstanceOf(ConfirmError);

    expect(store.get(id)?.writtenSpendingRowId).toBeNull();
  });
});

describe('discarding', () => {
  it('clears the draft and writes nothing', async () => {
    const { service, store, createSpendingRow, createBudgetLine } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    expect(service.discard(id)).toBe(true);

    expect(store.get(id)).toBeUndefined();
    expect(createSpendingRow).not.toHaveBeenCalled();
    expect(createBudgetLine).not.toHaveBeenCalled();
  });

  it('leaves a discarded draft unconfirmable', async () => {
    const { service } = setup();
    const { id } = await service.captureFromText({ text: 'woolies' });

    service.discard(id);

    await expect(service.confirm(id)).rejects.toBeInstanceOf(UnknownDraftError);
  });
});
