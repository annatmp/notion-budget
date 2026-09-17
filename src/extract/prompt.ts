import type { BudgetLine } from '@/notion/budget-lines';

/**
 * The system prefix sent with every extraction.
 *
 * Everything that does not vary between two calls belongs here: DeepSeek caches
 * the prefix, and a cache hit costs a hundredth of a miss. So the instructions,
 * the budget's vocabulary and the budget line list are all assembled in a fixed
 * order, and the line list is sorted, so that an unchanged budget produces a
 * byte-identical prefix and the cache actually applies
 * (`design.md` — "Extraction and matching in one model call").
 *
 * The current date is the one part that legitimately changes, and only daily.
 */

export interface PrefixInput {
  categories: string[];
  currencies: string[];
  defaultCurrency: string;
  budgetLines: BudgetLine[];
  /** Today in the trip's timezone, `YYYY-MM-DD`. */
  today: string;
  timezone: string;
}

export function buildSystemPrefix(input: PrefixInput): string {
  const lines = [...input.budgetLines]
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .map((line) => `${line.id} | ${line.name} | ${line.category}`)
    .join('\n');

  return [
    'You extract a single expense from a receipt photo or a short sentence, and',
    'choose the budget line it draws down.',
    '',
    'Reply with JSON only, matching the supplied schema exactly. Do not add prose.',
    '',
    '## The expense',
    '',
    '- `description`: a short merchant or purpose, as a person would write it',
    '  ("Woolworths", "Coffee"). Not the raw input text.',
    '- `amount`: the total actually paid. When a receipt shows a subtotal and a',
    '  total, use the total. Never a line item, and never a pre-discount figure.',
    '  Use null when no amount can be read at all.',
    '- `statedCurrency`: the currency the input states or symbolises, in whatever',
    '  form it appears ("EURO", "euro", "€", "USD"). Use null when the input gives',
    '  no currency indication. Do not guess from the merchant.',
    '- `date`: the date on the receipt or in the text, as YYYY-MM-DD. Relative',
    '  expressions resolve against the current date given below. Use null when no',
    '  date can be read.',
    '- `assumed`: true for each field you inferred rather than read.',
    '- `confidence`: "low" when the amount was hard to read or ambiguous.',
    '',
    '## The budget line',
    '',
    'Choose from this exact list. Match on both the name and the category.',
    '',
    lines === '' ? '(the budget has no lines yet)' : lines,
    '',
    'Prefer a specific line over a general one. If two lines are plausible, pick',
    'the better fit and list the others in `alternatives`. If nothing fits, return',
    '`kind: "proposed"` with a name for the new line and a category from this',
    'exact list:',
    '',
    input.categories.join(', '),
    '',
    'Never invent a category, and never propose a line when an existing one fits.',
    '',
    '## The budget',
    '',
    `Currencies in use: ${input.currencies.join(', ')}`,
    `Default when the input states none: ${input.defaultCurrency}`,
    `Current date: ${input.today} (timezone ${input.timezone})`,
  ].join('\n');
}

/** A free-text spend, as typed by the user. */
export function buildTextMessage(text: string): string {
  return `Spend: ${text}`;
}

/** A receipt photo, passed as a base64 data URL so it is never publicly addressable. */
export function buildImageMessage(dataUrl: string, caption?: string): string {
  const lines = ['Extract the expense from this receipt photograph.'];
  if (caption !== undefined && caption.trim() !== '') {
    lines.push(`The user added: ${caption.trim()}`);
  }
  lines.push('', `image: ${dataUrl}`);
  return lines.join('\n');
}
