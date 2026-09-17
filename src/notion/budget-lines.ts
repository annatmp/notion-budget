import type { NotionClient } from './client';
import { readSelect, readTitle, selectProperty, titleProperty } from './properties';

/** The identifier, name and category the rest of the app works with. */
export interface BudgetLine {
  id: string;
  name: string;
  category: string;
}

/** Which data source and property names the budget binding uses. */
export interface BudgetLineBinding {
  dataSourceId: string;
  properties: { title: string; category: string };
}

export interface NewBudgetLine {
  name: string;
  category: string;
}

/**
 * Reads every line item from the configured budget data source.
 *
 * Read fresh on every capture rather than cached: with two people logging
 * against the same budget, a line one of them creates has to be visible to the
 * other on their very next capture, or they are pushed toward proposing a
 * duplicate line (`design.md` — "Budget lines are re-read on every capture").
 */
export async function readBudgetLines(
  client: NotionClient,
  binding: BudgetLineBinding,
): Promise<BudgetLine[]> {
  const pages = await client.queryDataSource(binding.dataSourceId);

  return pages.map((page) => ({
    id: page.id,
    name: readTitle(page.properties, binding.properties.title),
    category: readSelect(page.properties, binding.properties.category),
  }));
}

/**
 * Creates a budget line, used only when the user has explicitly accepted a
 * proposal. The category is written literally, so it must already be one of the
 * configured options.
 */
export async function createBudgetLine(
  client: NotionClient,
  binding: BudgetLineBinding,
  input: NewBudgetLine,
): Promise<BudgetLine> {
  const page = await client.createPage(binding.dataSourceId, {
    [binding.properties.title]: titleProperty(input.name),
    [binding.properties.category]: selectProperty(input.category),
  });

  return {
    id: page.id,
    name: readTitle(page.properties, binding.properties.title),
    category: readSelect(page.properties, binding.properties.category),
  };
}
