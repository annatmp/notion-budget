import { z } from 'zod';

import { isIsoDate } from './time';

/**
 * What the model is asked to return, and what the app actually works with.
 *
 * The two are deliberately different. The model reports only what it read — a
 * stated currency, a date it could see — and the app applies the budget's
 * vocabulary and defaults afterwards. That keeps the budget-dependent rules in
 * code, where they are deterministic and testable, instead of in a prompt.
 */

const isoDate = z.string().trim().refine(isIsoDate, 'date must be a real YYYY-MM-DD date');

const alternativeSchema = z.object({
  lineId: z.string().trim().min(1),
  reason: z.string().trim().min(1),
});

const matchSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('existing'),
    lineId: z.string().trim().min(1),
    confidence: z.enum(['high', 'medium', 'low']),
    reason: z.string().trim().min(1),
    alternatives: z.array(alternativeSchema).default([]),
  }),
  z.object({
    kind: z.literal('proposed'),
    name: z.string().trim().min(1),
    category: z.string().trim().min(1),
    reason: z.string().trim().min(1),
  }),
]);

export const modelResponseSchema = z.object({
  description: z.string().trim().min(1),
  /**
   * `null` is a legitimate answer meaning "no amount could be read", and is
   * reported as such. A present-but-nonsensical amount — zero, negative, NaN —
   * is a schema violation instead, because it means the model misunderstood the
   * request rather than that the input lacked an amount.
   */
  amount: z.number().finite().positive().nullable(),
  /** What the input stated, in its own words. `null` when it stated nothing. */
  statedCurrency: z.string().trim().min(1).nullable(),
  /** `null` when no date could be read, in which case the app supplies today. */
  date: isoDate.nullable(),
  assumed: z.object({
    description: z.boolean(),
    amount: z.boolean(),
    date: z.boolean(),
  }),
  confidence: z.enum(['high', 'low']),
  match: matchSchema,
});

export type ModelResponse = z.infer<typeof modelResponseSchema>;

export type Confidence = 'high' | 'medium' | 'low';

export interface BudgetLineAlternative {
  lineId: string;
  reason: string;
}

export type DraftMatch =
  | {
      kind: 'existing';
      lineId: string;
      confidence: Confidence;
      reason: string;
      alternatives: BudgetLineAlternative[];
    }
  | { kind: 'proposed'; name: string; category: string; reason: string };

/** Which of the four fields were assumed rather than read from the input. */
export interface AssumedFields {
  description: boolean;
  amount: boolean;
  currency: boolean;
  date: boolean;
}

/** A draft expense as the review step sees it. Nothing here is written yet. */
export interface DraftExpense {
  description: string;
  amount: number;
  currency: string;
  /** ISO `YYYY-MM-DD`. */
  date: string;
  assumed: AssumedFields;
  confidence: 'high' | 'low';
  /** A stated currency the budget does not support, kept so review can say so. */
  unsupportedCurrency: string | null;
  match: DraftMatch;
}

/**
 * Why an extraction produced no draft. Each maps to different advice, so the API
 * layer can say something useful rather than "something went wrong".
 */
export type ExtractionFailure =
  | 'no-amount'
  | 'invalid-response'
  | 'model-unreachable'
  | 'unknown-budget-line'
  | 'unknown-category'
  | 'unsupported-format';

export class ExtractionError extends Error {
  override readonly name = 'ExtractionError';

  constructor(
    readonly failure: ExtractionFailure,
    message: string,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
  }
}
