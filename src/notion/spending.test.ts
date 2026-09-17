import { describe, expect, it } from 'vitest';

import { NotionClient } from './client';
import { NotionRelationTargetMissingError } from './errors';
import { createSpendingRow } from './spending';
import { fakeFetch, type StubReply } from './test-fetch';

const binding = {
  dataSourceId: '3ca86094-f992-809a-9ca6-000bea693d94',
  properties: {
    title: 'Name',
    price: 'Price',
    currency: 'Currency',
    date: 'Date paid/to be paid',
    relation: '💸 Budget',
  },
};

const expense = {
  description: 'Woolworths',
  amount: 43.2,
  currency: 'AUD',
  date: '2026-09-17',
  budgetLineId: 'line-1',
};

function setup(replies: StubReply[]) {
  const fake = fakeFetch(replies);
  const client = new NotionClient({
    token: 'ntn_test_token',
    version: '2025-09-03',
    fetch: fake.fetchImpl,
  });
  return { client, requests: fake.requests };
}

describe('writing a confirmed expense', () => {
  it('carries the description, amount, currency, date and relation', async () => {
    const { client, requests } = setup([{ body: { id: 'row-1', properties: {} } }]);

    const written = await createSpendingRow(client, binding, expense);

    expect(written.id).toBe('row-1');

    const properties = (requests[0]?.body as { properties: Record<string, unknown> }).properties;
    expect(properties.Name).toEqual({
      title: [{ type: 'text', text: { content: 'Woolworths' } }],
    });
    expect(properties.Price).toEqual({ number: 43.2 });
    expect(properties.Currency).toEqual({ select: { name: 'AUD' } });
    expect(properties['Date paid/to be paid']).toEqual({ date: { start: '2026-09-17' } });
    expect(properties['💸 Budget']).toEqual({ relation: [{ id: 'line-1' }] });
  });

  it('never writes the read-only formula properties', async () => {
    // `AUS` and `EUR` are formulas computed from Price and Currency. Notion
    // rejects any attempt to set them, so they must never appear in a payload.
    const { client, requests } = setup([{ body: { id: 'row-1', properties: {} } }]);

    await createSpendingRow(client, binding, expense);

    const properties = (requests[0]?.body as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties)).not.toContain('AUS');
    expect(Object.keys(properties)).not.toContain('EUR');
    expect(Object.keys(properties)).toHaveLength(5);
  });

  it('writes to the spending data source, not the budget one', async () => {
    const { client, requests } = setup([{ body: { id: 'row-1', properties: {} } }]);

    await createSpendingRow(client, binding, expense);

    expect((requests[0]?.body as { parent: { data_source_id: string } }).parent.data_source_id).toBe(
      binding.dataSourceId,
    );
  });

  it('sends an amount as a number rather than a string', async () => {
    const { client, requests } = setup([{ body: { id: 'row-1', properties: {} } }]);

    await createSpendingRow(client, binding, expense);

    const properties = (requests[0]?.body as { properties: Record<string, unknown> }).properties;
    expect((properties.Price as { number: unknown }).number).toBeTypeOf('number');
  });

  it('reports a budget line that no longer exists as its own failure', async () => {
    // The line was deleted between review and confirm. The user picks another
    // line; retrying unchanged would fail the same way.
    const { client } = setup([
      {
        status: 400,
        body: {
          code: 'validation_error',
          message: '💸 Budget does not reference a valid relation',
        },
      },
    ]);

    await expect(createSpendingRow(client, binding, expense)).rejects.toBeInstanceOf(
      NotionRelationTargetMissingError,
    );
  });

  it('does not report a row when the write failed', async () => {
    const { client } = setup([
      { status: 400, body: { code: 'validation_error', message: 'Price is not a number' } },
    ]);

    await expect(createSpendingRow(client, binding, expense)).rejects.toThrow();
  });
});
