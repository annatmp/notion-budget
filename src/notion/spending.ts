import type { NotionClient } from './client';
import {
  dateProperty,
  numberProperty,
  relationProperty,
  selectProperty,
  titleProperty,
} from './properties';

/** Which data source and property names the spending binding uses. */
export interface SpendingBinding {
  dataSourceId: string;
  properties: {
    title: string;
    price: string;
    currency: string;
    date: string;
    relation: string;
  };
}

export interface NewSpendingRow {
  description: string;
  amount: number;
  currency: string;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  budgetLineId: string;
}

export interface WrittenSpendingRow {
  id: string;
}

/**
 * Creates the spending row for a confirmed expense.
 *
 * Only the five configured properties are ever written. The `AUS` and `EUR`
 * columns in the live Spending database are formulas computed from price and
 * currency, and Notion rejects any attempt to set them — the way to avoid that
 * is to name every property explicitly, as here, rather than to filter them out
 * afterwards (`design.md`, Context).
 */
export async function createSpendingRow(
  client: NotionClient,
  binding: SpendingBinding,
  input: NewSpendingRow,
): Promise<WrittenSpendingRow> {
  const page = await client.createPage(
    binding.dataSourceId,
    {
      [binding.properties.title]: titleProperty(input.description),
      [binding.properties.price]: numberProperty(input.amount),
      [binding.properties.currency]: selectProperty(input.currency),
      [binding.properties.date]: dateProperty(input.date),
      [binding.properties.relation]: relationProperty(input.budgetLineId),
    },
    { relationProperty: binding.properties.relation },
  );

  return { id: page.id };
}
