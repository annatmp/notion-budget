/**
 * Mapping a stated currency onto one the budget actually supports.
 *
 * This is deliberately ours rather than the model's. "Every draft expense SHALL
 * carry a currency that is one of the currencies configured for the target
 * budget" is a statement about the budget's vocabulary, and the budget's
 * vocabulary lives in configuration — so the resolution rule should be
 * deterministic code, not a judgement call inside a prompt.
 */

/**
 * Spellings that unambiguously mean one currency. Single `$` is deliberately
 * absent: it is AUD, USD and several others, so guessing would silently mislabel
 * a receipt. An ambiguous symbol falls through to the default and is recorded as
 * unrecognised, which the review step can surface.
 */
const ALIASES: Record<string, string[]> = {
  EURO: ['€', 'eur', 'euro', 'euros'],
  EUR: ['€', 'eur', 'euro', 'euros'],
  AUD: ['aud', 'a$', 'australian dollar', 'australian dollars'],
  USD: ['usd', 'us$', 'us dollar', 'us dollars'],
  GBP: ['£', 'gbp', 'pound', 'pounds'],
  NZD: ['nzd', 'nz$', 'new zealand dollar', 'new zealand dollars'],
};

export interface CurrencyResolution {
  /** Always one of the configured options. */
  currency: string;
  /** True when the value is a fallback rather than something the input stated. */
  assumed: boolean;
  /** The stated currency that was not supported, for the review step to surface. */
  unsupported?: string;
}

export interface CurrencyOptions {
  currencies: string[];
  defaultCurrency: string;
}

/**
 * Resolves what the input stated onto a configured option.
 *
 * A `null` statement means the input gave no currency indication at all, which
 * the spec treats the same way as an unrecognised one: use the default and mark
 * the field assumed.
 */
export function resolveCurrency(
  stated: string | null,
  options: CurrencyOptions,
): CurrencyResolution {
  const wanted = stated?.trim() ?? '';
  if (wanted === '') {
    return { currency: options.defaultCurrency, assumed: true };
  }

  const match = matchConfigured(wanted, options.currencies);
  if (match !== undefined) {
    return { currency: match, assumed: false };
  }

  return { currency: options.defaultCurrency, assumed: true, unsupported: wanted };
}

function matchConfigured(stated: string, currencies: string[]): string | undefined {
  const normalised = stated.toLowerCase();

  for (const currency of currencies) {
    if (currency.toLowerCase() === normalised) {
      return currency;
    }
    const aliases = ALIASES[currency.toUpperCase()] ?? [];
    if (aliases.includes(normalised)) {
      return currency;
    }
  }

  return undefined;
}
