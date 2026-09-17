import { z } from 'zod';

import type { BudgetLine } from '@/notion/budget-lines';

import type { ContentPart, DeepSeekClient } from './client';
import { resolveCurrency } from './currency';
import {
  type DraftExpense,
  type DraftMatch,
  ExtractionError,
  type ModelResponse,
  modelResponseSchema,
} from './draft';
import { buildImageMessage, buildSystemPrefix, buildTextMessage } from './prompt';
import { todayInTimezone } from './time';

/** DeepSeek resizes every image regardless, so these are the formats it takes. */
export const SUPPORTED_IMAGE_TYPES: readonly string[] = [
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
];

export interface ExtractionContext {
  /** Narrowed to the one method used, so tests can supply a stub. */
  client: Pick<DeepSeekClient, 'complete'>;
  budgetLines: BudgetLine[];
  categories: string[];
  currencies: string[];
  defaultCurrency: string;
  timezone: string;
  now?: () => Date;
}

/** Validates the model's reply, or fails the extraction. Never patches it. */
export function parseModelResponse(raw: unknown): ModelResponse {
  const result = modelResponseSchema.safeParse(raw);
  if (!result.success) {
    const detail = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(response)'}: ${issue.message}`)
      .join('; ');
    throw new ExtractionError(
      'invalid-response',
      `The extraction model returned a response that does not match the schema (${detail})`,
    );
  }
  return result.data;
}

/**
 * Applies the budget's vocabulary and defaults to a validated response.
 *
 * Everything budget-specific happens here rather than in the prompt, so it is
 * deterministic: which currencies are supported, which categories exist, and
 * which budget lines are real.
 */
export function toDraft(response: ModelResponse, context: ExtractionContext): DraftExpense {
  if (response.amount === null) {
    throw new ExtractionError(
      'no-amount',
      'No amount could be read from that input. Enter the spend as text, including the amount.',
    );
  }

  const currency = resolveCurrency(response.statedCurrency, {
    currencies: context.currencies,
    defaultCurrency: context.defaultCurrency,
  });

  const date = response.date ?? todayInTimezone(context.timezone, context.now?.() ?? new Date());

  return {
    description: response.description,
    amount: response.amount,
    currency: currency.currency,
    date,
    assumed: {
      description: response.assumed.description,
      amount: response.assumed.amount,
      currency: currency.assumed,
      // A date the app supplied is an assumption even if the model said nothing,
      // which is exactly the case the review step has to flag.
      date: response.assumed.date || response.date === null,
    },
    confidence: response.confidence,
    unsupportedCurrency: currency.unsupported ?? null,
    match: resolveMatch(response.match, context),
  };
}

function resolveMatch(match: ModelResponse['match'], context: ExtractionContext): DraftMatch {
  if (match.kind === 'proposed') {
    if (!context.categories.includes(match.category)) {
      throw new ExtractionError(
        'unknown-category',
        `The extraction proposed the category "${match.category}", which is not one of the budget's categories.`,
      );
    }
    return { kind: 'proposed', name: match.name, category: match.category, reason: match.reason };
  }

  const byId = new Map(context.budgetLines.map((line) => [line.id, line]));
  const matched = byId.get(match.lineId);
  if (matched === undefined) {
    // Matching is restricted to lines that exist at the time of matching, so a
    // line id that is not in the list is not a match however confident it looks.
    throw new ExtractionError(
      'unknown-budget-line',
      `The extraction matched budget line ${match.lineId}, which is not in the current budget.`,
    );
  }

  return {
    kind: 'existing',
    lineId: matched.id,
    lineName: matched.name,
    confidence: match.confidence,
    reason: match.reason,
    alternatives: match.alternatives.filter((alternative) => byId.has(alternative.lineId)),
  };
}

/** Rejects an unsupported image before any model call is made. */
export function assertSupportedImage(dataUrl: string): void {
  const mediaType = /^data:([^;,]+)[;,]/.exec(dataUrl)?.[1]?.toLowerCase();

  if (mediaType === undefined || !SUPPORTED_IMAGE_TYPES.includes(mediaType)) {
    throw new ExtractionError(
      'unsupported-format',
      `That file type is not supported. Send one of: ${SUPPORTED_IMAGE_TYPES.join(', ')}.`,
    );
  }
}

export async function extractFromText(
  text: string,
  context: ExtractionContext,
): Promise<DraftExpense> {
  return run([{ type: 'text', text: buildTextMessage(text) }], context);
}

export async function extractFromImage(
  dataUrl: string,
  context: ExtractionContext,
  caption?: string,
): Promise<DraftExpense> {
  assertSupportedImage(dataUrl);
  return run(
    [
      { type: 'text', text: buildImageMessage(dataUrl, caption) },
      { type: 'image_url', image_url: { url: dataUrl } },
    ],
    context,
  );
}

async function run(contents: ContentPart[], context: ExtractionContext): Promise<DraftExpense> {
  const system = buildSystemPrefix({
    categories: context.categories,
    currencies: context.currencies,
    defaultCurrency: context.defaultCurrency,
    budgetLines: context.budgetLines,
    today: todayInTimezone(context.timezone, context.now?.() ?? new Date()),
    timezone: context.timezone,
  });

  const raw = await context.client.complete({
    system,
    contents,
    responseSchema: responseSchema(),
  });

  return toDraft(parseModelResponse(raw), context);
}

function responseSchema(): Record<string, unknown> {
  const schema = z.toJSONSchema(modelResponseSchema) as Record<string, unknown>;
  // Providers reject the dialect marker; the schema itself is what matters.
  delete schema.$schema;
  return schema;
}
