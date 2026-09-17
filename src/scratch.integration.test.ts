import { readFileSync } from 'node:fs';

import { beforeAll, describe, expect, it } from 'vitest';

import { loadConfig, type Config } from '@/config';
import { DraftService } from '@/drafts/service';
import { DraftStore } from '@/drafts/store';
import type { DraftExpense } from '@/extract/draft';

import { createBudgetLine, readBudgetLines, type BudgetLineBinding } from './notion/budget-lines';
import { NotionClient } from './notion/client';
import { createSpendingRow, type SpendingBinding } from './notion/spending';

/**
 * Verification that writes, against a throwaway copy of the budget.
 *
 * Opt in explicitly, because it creates real rows:
 *
 *   SCRATCH_TESTS=1 DEV_AUTH_BYPASS=true npx vitest run src/scratch.integration.test.ts
 *
 * `DEV_AUTH_BYPASS=true` is needed only because the configuration also validates
 * the Access values, which a local run does not set.
 *
 * Rows created here are left behind. Nothing in this app deletes a Notion row,
 * and adding a delete path purely to tidy up after tests would be a worse trade
 * than a scratch table with some residue in it.
 */

/** The live trip data sources, from `design.md`. */
const LIVE_BUDGET_DATA_SOURCE = '3ca86094-f992-8055-943e-000b8fecdada';
const LIVE_SPENDING_DATA_SOURCE = '3ca86094-f992-809a-9ca6-000bea693d94';

const enabled = process.env.SCRATCH_TESTS === '1';

/** A distinctive prefix so probe rows are recognisable in the scratch table. */
const MARKER = `[probe ${new Date().toISOString().slice(0, 19)}]`;

function loadLocalEnv(path = '.env.local'): void {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch {
    return;
  }

  for (const line of text.split('\n')) {
    const match = /^\s*([A-Z][A-Z0-9_]*)\s*=\s*(.*)$/.exec(line);
    if (match === null) {
      continue;
    }
    const [, key, raw] = match;
    // A real environment variable wins, so CI can override the file.
    if (process.env[key] === undefined) {
      process.env[key] = raw.trim();
    }
  }
}

function budgetBinding(config: Config): BudgetLineBinding {
  return {
    dataSourceId: config.notion.budgetDataSourceId,
    properties: {
      title: config.notion.properties.budgetTitle,
      category: config.notion.properties.budgetCategory,
    },
  };
}

function spendingBinding(config: Config): SpendingBinding {
  return {
    dataSourceId: config.notion.spendingDataSourceId,
    properties: {
      title: config.notion.properties.spendingTitle,
      price: config.notion.properties.spendingPrice,
      currency: config.notion.properties.spendingCurrency,
      date: config.notion.properties.spendingDate,
      relation: config.notion.properties.spendingBudgetRelation,
    },
  };
}

describe.skipIf(!enabled)('writing against the scratch duplicate', () => {
  let config: Config;
  let client: NotionClient;

  beforeAll(() => {
    loadLocalEnv();
    config = loadConfig();

    // The guard that matters. If configuration ever points back at the trip's
    // real budget, this suite writes nothing and says why.
    if (
      config.notion.budgetDataSourceId === LIVE_BUDGET_DATA_SOURCE ||
      config.notion.spendingDataSourceId === LIVE_SPENDING_DATA_SOURCE
    ) {
      throw new Error(
        'Refusing to run: the configured data sources are the live trip budget, not a scratch duplicate.',
      );
    }

    client = new NotionClient({
      token: config.notion.token,
      version: config.notion.version,
    });
  });

  it('reads the scratch budget and finds its categories configured', async () => {
    const lines = await readBudgetLines(client, budgetBinding(config));

    expect(Array.isArray(lines)).toBe(true);
    // Every line must come back with a category, or matching has nothing to
    // work with.
    for (const line of lines) {
      expect(config.categories).toContain(line.category);
    }
  });

  it('creates a budget line carrying the exact category option name (2.4)', async () => {
    // The first configured category, written literally. `Accomodation` is not a
    // typo to be corrected — it is the live option name.
    const category = config.categories[0] as string;
    const name = `${MARKER} line`;

    const created = await createBudgetLine(client, budgetBinding(config), { name, category });

    expect(created.id).not.toBe('');
    expect(created.category).toBe(category);

    // Read it back from Notion rather than trusting the create response.
    const lines = await readBudgetLines(client, budgetBinding(config));
    const stored = lines.find((line) => line.id === created.id);

    expect(stored?.name).toBe(name);
    expect(stored?.category).toBe(category);
  });

  it('creates a spending row with every field set and the relation resolving (2.3)', async () => {
    const [line] = await readBudgetLines(client, budgetBinding(config));
    expect(line).toBeDefined();

    const description = `${MARKER} spend`;
    const written = await createSpendingRow(client, spendingBinding(config), {
      description,
      amount: 12.34,
      currency: config.defaultCurrency,
      date: '2026-09-17',
      budgetLineId: (line as { id: string }).id,
    });

    expect(written.id).not.toBe('');

    const pages = await client.queryDataSource(config.notion.spendingDataSourceId);
    const stored = pages.find((page) => page.id === written.id);
    expect(stored).toBeDefined();

    const properties = (stored as { properties: Record<string, { [key: string]: unknown }> })
      .properties;
    const p = config.notion.properties;

    expect(properties[p.spendingTitle]?.title).toBeDefined();
    expect(properties[p.spendingPrice]?.number).toBe(12.34);
    expect(properties[p.spendingCurrency]?.select).toMatchObject({ name: config.defaultCurrency });
    expect(properties[p.spendingDate]?.date).toMatchObject({ start: '2026-09-17' });

    // The relation resolving is the point: an expense that relates to nothing
    // is invisible in the budget's rollups.
    const relation = properties[p.spendingBudgetRelation]?.relation as Array<{ id: string }>;
    expect(relation.map((entry) => entry.id)).toContain((line as { id: string }).id);
  });

  it('leaves every pre-existing row exactly as it was (2.6)', async () => {
    const snapshot = async () =>
      (await client.queryDataSource(config.notion.spendingDataSourceId))
        .map((page) => JSON.parse(JSON.stringify(page)) as { id: string })
        .sort((a, b) => (a.id < b.id ? -1 : 1));

    const before = await snapshot();

    const [line] = await readBudgetLines(client, budgetBinding(config));
    await createSpendingRow(client, spendingBinding(config), {
      description: `${MARKER} untouched check`,
      amount: 1.11,
      currency: config.defaultCurrency,
      date: '2026-09-17',
      budgetLineId: (line as { id: string }).id,
    });

    const after = await snapshot();

    expect(after).toHaveLength(before.length + 1);

    // Every row that existed before is byte-identical afterwards: the app
    // appends and never edits or removes.
    for (const row of before) {
      expect(after.find((candidate) => candidate.id === row.id)).toEqual(row);
    }
  });

  it('creates the accepted budget line first, then relates the row to it (4.4)', async () => {
    const proposedName = `${MARKER} proposed line`;
    const category = config.categories[1] ?? (config.categories[0] as string);

    const service = new DraftService({
      store: new DraftStore(),
      readBudgetLines: () => readBudgetLines(client, budgetBinding(config)),
      createBudgetLine: (input) => createBudgetLine(client, budgetBinding(config), input),
      createSpendingRow: (input) => createSpendingRow(client, spendingBinding(config), input),
      extraction: {
        client: { complete: async () => ({}) },
        categories: config.categories,
        currencies: config.currencies,
        defaultCurrency: config.defaultCurrency,
        timezone: config.timezone,
      },
      runTextExtraction: async (): Promise<DraftExpense> => ({
        description: `${MARKER} as extracted`,
        amount: 7,
        currency: config.defaultCurrency,
        date: '2026-09-17',
        assumed: { description: false, amount: false, currency: false, date: false },
        confidence: 'high',
        unsupportedCurrency: null,
        match: {
          kind: 'proposed',
          name: proposedName,
          category,
          reason: 'nothing in the scratch budget fits',
        },
      }),
    });

    const { id } = await service.captureFromText({ text: 'anything' });

    // Commit *edited* values, not the extracted ones — the spec requires the
    // user's corrections to be what lands.
    await service.edit(id, { amount: 9.99, description: `${MARKER} as edited` });

    const result = await service.confirm(id);
    expect(result.written).toBe(true);
    expect(result.createdBudgetLine).toBe(true);

    // The budget line exists with the proposed name and the literal category.
    const lines = await readBudgetLines(client, budgetBinding(config));
    const createdLine = lines.find((line) => line.id === result.budgetLineId);
    expect(createdLine?.name).toBe(proposedName);
    expect(createdLine?.category).toBe(category);

    // The spending row exists and relates to that new line.
    const pages = await client.queryDataSource(config.notion.spendingDataSourceId);
    const row = pages.find((page) => page.id === result.spendingRowId);
    expect(row).toBeDefined();

    const properties = (row as { properties: Record<string, { [key: string]: unknown }> })
      .properties;
    const p = config.notion.properties;
    expect(properties[p.spendingPrice]?.number).toBe(9.99);
    expect(properties[p.spendingBudgetRelation]?.relation).toEqual([{ id: result.budgetLineId }]);
  });

  it('writes exactly one row when a confirmation is repeated (4.6)', async () => {
    const service = new DraftService({
      store: new DraftStore(),
      readBudgetLines: () => readBudgetLines(client, budgetBinding(config)),
      createBudgetLine: (input) => createBudgetLine(client, budgetBinding(config), input),
      createSpendingRow: (input) => createSpendingRow(client, spendingBinding(config), input),
      extraction: {
        client: { complete: async () => ({}) },
        categories: config.categories,
        currencies: config.currencies,
        defaultCurrency: config.defaultCurrency,
        timezone: config.timezone,
      },
      runTextExtraction: async (): Promise<DraftExpense> => {
        const [line] = await readBudgetLines(client, budgetBinding(config));
        return {
          description: `${MARKER} idempotent`,
          amount: 3.33,
          currency: config.defaultCurrency,
          date: '2026-09-17',
          assumed: { description: false, amount: false, currency: false, date: false },
          confidence: 'high',
          unsupportedCurrency: null,
          match: {
            kind: 'existing',
            lineId: (line as { id: string }).id,
            lineName: (line as { name: string }).name,
            confidence: 'high',
            reason: 'fits',
            alternatives: [],
          },
        };
      },
    });

    const { id } = await service.captureFromText({ text: 'anything' });

    const countRows = async () =>
      (await client.queryDataSource(config.notion.spendingDataSourceId)).length;

    const before = await countRows();
    const first = await service.confirm(id);
    const second = await service.confirm(id);
    const after = await countRows();

    expect(second.spendingRowId).toBe(first.spendingRowId);
    expect(second.written).toBe(false);
    expect(after).toBe(before + 1);
  });
});
