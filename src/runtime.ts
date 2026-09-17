import { loadConfig } from '@/config';
import { DEFAULT_DRAFT_TTL_MS, DraftStore } from '@/drafts/store';
import { DraftService } from '@/drafts/service';
import { DeepSeekClient } from '@/extract/client';
import { createBudgetLine, readBudgetLines } from '@/notion/budget-lines';
import { NotionClient } from '@/notion/client';
import { createSpendingRow } from '@/notion/spending';

/**
 * The composition root, and the only module that binds the Notion writers into
 * anything callable.
 *
 * Keeping the wiring here is what makes "nothing is written without
 * confirmation" checkable rather than merely intended: the writers reach exactly
 * one consumer — `DraftService` — and inside it they are called from `confirm`
 * and nowhere else. A test asserts the import graph, so a future shortcut that
 * grabs `createSpendingRow` from a request handler fails the build.
 */

let service: DraftService | undefined;

export function getDraftService(): DraftService {
  service ??= build();
  return service;
}

function build(): DraftService {
  const config = loadConfig();

  const notion = new NotionClient({
    token: config.notion.token,
    version: config.notion.version,
  });

  const deepseek = new DeepSeekClient({
    apiKey: config.deepseek.apiKey,
    modelId: config.deepseek.modelId,
  });

  const budgetBinding = {
    dataSourceId: config.notion.budgetDataSourceId,
    properties: {
      title: config.notion.properties.budgetTitle,
      category: config.notion.properties.budgetCategory,
    },
  };

  const spendingBinding = {
    dataSourceId: config.notion.spendingDataSourceId,
    properties: {
      title: config.notion.properties.spendingTitle,
      price: config.notion.properties.spendingPrice,
      currency: config.notion.properties.spendingCurrency,
      date: config.notion.properties.spendingDate,
      relation: config.notion.properties.spendingBudgetRelation,
    },
  };

  return new DraftService({
    store: new DraftStore(DEFAULT_DRAFT_TTL_MS),
    readBudgetLines: () => readBudgetLines(notion, budgetBinding),
    createBudgetLine: (input) => createBudgetLine(notion, budgetBinding, input),
    createSpendingRow: (input) => createSpendingRow(notion, spendingBinding, input),
    extraction: {
      client: deepseek,
      categories: config.categories,
      currencies: config.currencies,
      defaultCurrency: config.defaultCurrency,
      timezone: config.timezone,
    },
  });
}

/** Drops the memoised service. A test seam. */
export function resetRuntime(): void {
  service = undefined;
}
