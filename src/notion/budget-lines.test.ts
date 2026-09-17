import { describe, expect, it } from 'vitest';

import { createBudgetLine, readBudgetLines } from './budget-lines';
import { NotionClient } from './client';
import { fakeFetch, type StubReply } from './test-fetch';

const binding = {
  dataSourceId: '3ca86094-f992-8055-943e-000b8fecdada',
  properties: { title: 'Item', category: 'Category' },
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

function notionRow(id: string, item: string, category?: string) {
  return {
    id,
    properties: {
      Item: { title: [{ plain_text: item }] },
      Category: category === undefined ? { select: null } : { select: { name: category } },
    },
  };
}

describe('reading budget lines', () => {
  it('returns every line with its identifier, name and category', async () => {
    const { client } = setup([
      {
        body: {
          results: [
            notionRow('line-1', "Coffee's and snacks", 'Food'),
            notionRow('line-2', 'Food Sydney', 'Food'),
            notionRow('line-3', 'Accomodation Melbourne', 'Accomodation'),
          ],
        },
      },
    ]);

    await expect(readBudgetLines(client, binding)).resolves.toEqual([
      { id: 'line-1', name: "Coffee's and snacks", category: 'Food' },
      { id: 'line-2', name: 'Food Sydney', category: 'Food' },
      { id: 'line-3', name: 'Accomodation Melbourne', category: 'Accomodation' },
    ]);
  });

  it('reads across pages', async () => {
    const { client } = setup([
      { body: { results: [notionRow('a', 'One', 'Food')], has_more: true, next_cursor: 'c1' } },
      { body: { results: [notionRow('b', 'Two', 'Tours')], has_more: false } },
    ]);

    const lines = await readBudgetLines(client, binding);

    expect(lines.map((line) => line.id)).toEqual(['a', 'b']);
  });

  it('returns a line whose category is unset rather than dropping it', async () => {
    // Hiding it would make a line that exists unreachable in the override list.
    const { client } = setup([{ body: { results: [notionRow('line-1', 'Uncategorised')] } }]);

    await expect(readBudgetLines(client, binding)).resolves.toEqual([
      { id: 'line-1', name: 'Uncategorised', category: '' },
    ]);
  });

  it('copes with an empty budget', async () => {
    const { client } = setup([{ body: { results: [] } }]);

    await expect(readBudgetLines(client, binding)).resolves.toEqual([]);
  });
});

describe('creating a budget line', () => {
  it('writes the proposed name and category', async () => {
    const { client, requests } = setup([
      { body: notionRow('new-line', 'Scuba diving course', 'Activity') },
    ]);

    const created = await createBudgetLine(client, binding, {
      name: 'Scuba diving course',
      category: 'Activity',
    });

    expect(created).toEqual({ id: 'new-line', name: 'Scuba diving course', category: 'Activity' });

    const properties = (requests[0]?.body as { properties: Record<string, unknown> }).properties;
    expect(properties.Item).toEqual({
      title: [{ type: 'text', text: { content: 'Scuba diving course' } }],
    });
    expect(properties.Category).toEqual({ select: { name: 'Activity' } });
  });

  it('passes the category through verbatim, including the budget\u2019s own spelling', async () => {
    // `Accomodation` is how the live budget spells it. "Correcting" it here
    // would make the write fail against a select option that does not exist.
    const { client, requests } = setup([{ body: notionRow('new-line', 'Hostel', 'Accomodation') }]);

    await createBudgetLine(client, binding, { name: 'Hostel', category: 'Accomodation' });

    const properties = (requests[0]?.body as { properties: Record<string, unknown> }).properties;
    expect(properties.Category).toEqual({ select: { name: 'Accomodation' } });
  });

  it('writes only the two properties a budget line has', async () => {
    const { client, requests } = setup([{ body: notionRow('new-line', 'Museum', 'Activity') }]);

    await createBudgetLine(client, binding, { name: 'Museum', category: 'Activity' });

    const properties = (requests[0]?.body as { properties: Record<string, unknown> }).properties;
    expect(Object.keys(properties).sort()).toEqual(['Category', 'Item']);
  });

  it('targets the configured data source', async () => {
    const { client, requests } = setup([{ body: notionRow('new-line', 'Museum', 'Activity') }]);

    await createBudgetLine(client, binding, { name: 'Museum', category: 'Activity' });

    expect((requests[0]?.body as { parent: unknown }).parent).toEqual({
      type: 'data_source_id',
      data_source_id: binding.dataSourceId,
    });
  });
});
