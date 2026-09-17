import { createIdentityResolver, type IdentityResolver } from '@/auth/identity';
import { loadConfig } from '@/config';
import { DraftService } from '@/drafts/service';
import { DEFAULT_DRAFT_TTL_MS, DraftStore } from '@/drafts/store';
import { DeepSeekClient } from '@/extract/client';
import { createBudgetLine, readBudgetLines } from '@/notion/budget-lines';
import { NotionClient } from '@/notion/client';
import { createSpendingRow } from '@/notion/spending';
import { DailyRateLimiter } from '@/ratelimit/limiter';

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
let resolver: IdentityResolver | undefined;
let limiter: DailyRateLimiter | undefined;

export function getDraftService(): DraftService {
  service ??= build();
  return service;
}

export function getIdentityResolver(): IdentityResolver {
  resolver ??= createIdentityResolver(loadConfig());
  return resolver;
}

export function getRateLimiter(): DailyRateLimiter {
  if (limiter === undefined) {
    const config = loadConfig();
    limiter = new DailyRateLimiter(config.captureDailyLimit, { timezone: config.timezone });
  }
  return limiter;
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

/** Drops the memoised singletons. A test seam. */
export function resetRuntime(): void {
  service = undefined;
  resolver = undefined;
  limiter = undefined;
}
