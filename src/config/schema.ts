import { z } from 'zod';

/**
 * The single place that decides what the app needs in order to run.
 *
 * Validation happens once, at startup, and the app refuses to start on anything
 * incomplete. That is deliberate: a half-configured app would write confirmed
 * spends to the wrong data source, and a silent misconfiguration is far more
 * expensive than a refused boot (`specs/notion-integration` — "Budget binding is
 * configuration").
 *
 * Configuration is expressed in environment-variable names so that a failure
 * names the exact variable to set, and so `.env.example` and this schema can be
 * checked against each other rather than drifting apart.
 */

// --- Field types -----------------------------------------------------------

/** A required, non-blank string. */
const required = z.string().trim().min(1, 'is required');

/** A comma-separated list holding at least one non-blank entry. */
const commaList = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  )
  .refine((entries) => entries.length > 0, 'must list at least one value');

/**
 * `true`/`false` rather than `z.coerce.boolean()`, which reads the string
 * "false" as true. An unset or blank value means false.
 */
const booleanish = z.enum(['', 'true', 'false']).transform((value) => value === 'true');

/**
 * `data_source_id` addressing requires 2025-09-03 or later. Validated here
 * rather than defaulted in the client because a silent downgrade would
 * reintroduce the `database_id` ambiguity this database already exhibits
 * (design.md — "Notion API version drift").
 */
export const MINIMUM_NOTION_VERSION = '2025-09-03';

const notionVersion = required
  .refine((value) => /^\d{4}-\d{2}-\d{2}$/.test(value), 'must look like YYYY-MM-DD')
  .refine((value) => value >= MINIMUM_NOTION_VERSION, `must be ${MINIMUM_NOTION_VERSION} or later`);

/**
 * Checked by construction rather than against a hard-coded list, so a config
 * naming any real zone is accepted and a typo is refused.
 */
const timezone = required.refine((value) => {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value });
    return true;
  } catch {
    return false;
  }
}, 'must be a valid IANA time zone, such as Australia/Melbourne');

// --- Raw environment schema -------------------------------------------------

export const envSchema = z.object({
  // Notion binding
  NOTION_TOKEN: required,
  NOTION_VERSION: notionVersion,
  NOTION_BUDGET_DATA_SOURCE_ID: required,
  NOTION_SPENDING_DATA_SOURCE_ID: required,
  NOTION_BUDGET_TITLE_PROPERTY: required,
  NOTION_BUDGET_CATEGORY_PROPERTY: required,
  NOTION_SPENDING_TITLE_PROPERTY: required,
  NOTION_SPENDING_PRICE_PROPERTY: required,
  NOTION_SPENDING_CURRENCY_PROPERTY: required,
  NOTION_SPENDING_DATE_PROPERTY: required,
  NOTION_SPENDING_BUDGET_RELATION_PROPERTY: required,

  // Budget vocabulary. Select options are matched literally, so `EURO` and
  // `Accomodation` are configuration rather than constants someone will "fix".
  NOTION_CATEGORIES: commaList,
  NOTION_CURRENCIES: commaList,
  DEFAULT_CURRENCY: required,
  TRIP_TIMEZONE: timezone,

  // DeepSeek
  DEEPSEEK_API_KEY: required,
  DEEPSEEK_MODEL_ID: required,

  // Access control
  CF_ACCESS_TEAM_DOMAIN: required,
  CF_ACCESS_AUD: required,
  DEV_AUTH_BYPASS: booleanish,
  CAPTURE_DAILY_LIMIT: z.coerce.number().int().positive('must be a positive whole number'),

  // Runtime
  APP_ENV: z
    .enum(['', 'development', 'test', 'production'])
    .transform((value) => (value === '' ? 'development' : value)),
});

const configSchema = envSchema.superRefine((env, ctx) => {
  // An expense whose currency is not one the budget defines cannot be written,
  // so catching it at startup beats failing on the first confirmation.
  if (!env.NOTION_CURRENCIES.includes(env.DEFAULT_CURRENCY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['DEFAULT_CURRENCY'],
      message: `must be one of the configured currencies (${env.NOTION_CURRENCIES.join(', ')})`,
    });
  }
});

/** The environment variable names the app requires, in schema order. */
export const configKeys = Object.keys(envSchema.shape);

// --- Consumable config ------------------------------------------------------

export type AppEnv = z.infer<typeof envSchema>['APP_ENV'];

export type Config = {
  notion: {
    token: string;
    version: string;
    budgetDataSourceId: string;
    spendingDataSourceId: string;
    properties: {
      budgetTitle: string;
      budgetCategory: string;
      spendingTitle: string;
      spendingPrice: string;
      spendingCurrency: string;
      spendingDate: string;
      spendingBudgetRelation: string;
    };
  };
  /** Category options, matched literally against the budget's select values. */
  categories: string[];
  /** Currency options, matched literally. */
  currencies: string[];
  defaultCurrency: string;
  /** IANA zone used to resolve relative dates and "today". */
  timezone: string;
  deepseek: { apiKey: string; modelId: string };
  access: {
    teamDomain: string;
    audience: string;
    /** Local development only; refused under a production `APP_ENV`. */
    devBypass: boolean;
  };
  /** Daily per-identity ceiling on the capture endpoints. */
  captureDailyLimit: number;
  appEnv: AppEnv;
};

/** Thrown when the environment is incomplete or inconsistent. */
export class ConfigError extends Error {
  override readonly name = 'ConfigError';
}

/**
 * A bag of environment values. Deliberately not `NodeJS.ProcessEnv`: Next.js
 * augments that type to require `NODE_ENV`, and the schema should not depend on
 * which framework happens to be reading it.
 */
export type EnvSource = Record<string, string | undefined>;

function toDescription(error: z.ZodError): string {
  const lines = error.issues.map((issue) => {
    const key = issue.path.length > 0 ? issue.path.join('.') : '(configuration)';
    return `  ${key}: ${issue.message}`;
  });
  return ['Invalid configuration — the app will not start:', ...lines].join('\n');
}

/**
 * Fills absent keys with an empty string so that a missing value is reported as
 * "is required" naming the variable, rather than a type error. Keys not in the
 * schema are ignored.
 */
function normalise(source: EnvSource): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of configKeys) {
    out[key] = source[key] ?? '';
  }
  return out;
}

export function toConfig(env: z.infer<typeof envSchema>): Config {
  return {
    notion: {
      token: env.NOTION_TOKEN,
      version: env.NOTION_VERSION,
      budgetDataSourceId: env.NOTION_BUDGET_DATA_SOURCE_ID,
      spendingDataSourceId: env.NOTION_SPENDING_DATA_SOURCE_ID,
      properties: {
        budgetTitle: env.NOTION_BUDGET_TITLE_PROPERTY,
        budgetCategory: env.NOTION_BUDGET_CATEGORY_PROPERTY,
        spendingTitle: env.NOTION_SPENDING_TITLE_PROPERTY,
        spendingPrice: env.NOTION_SPENDING_PRICE_PROPERTY,
        spendingCurrency: env.NOTION_SPENDING_CURRENCY_PROPERTY,
        spendingDate: env.NOTION_SPENDING_DATE_PROPERTY,
        spendingBudgetRelation: env.NOTION_SPENDING_BUDGET_RELATION_PROPERTY,
      },
    },
    categories: env.NOTION_CATEGORIES,
    currencies: env.NOTION_CURRENCIES,
    defaultCurrency: env.DEFAULT_CURRENCY,
    timezone: env.TRIP_TIMEZONE,
    deepseek: {
      apiKey: env.DEEPSEEK_API_KEY,
      modelId: env.DEEPSEEK_MODEL_ID,
    },
    access: {
      teamDomain: env.CF_ACCESS_TEAM_DOMAIN,
      audience: env.CF_ACCESS_AUD,
      devBypass: env.DEV_AUTH_BYPASS,
    },
    captureDailyLimit: env.CAPTURE_DAILY_LIMIT,
    appEnv: env.APP_ENV,
  };
}

/**
 * Validates a full environment and returns the consumable config, or throws a
 * `ConfigError` naming every value that is missing or wrong.
 */
export function parseConfig(source: EnvSource = process.env): Config {
  const result = configSchema.safeParse(normalise(source));
  if (!result.success) {
    throw new ConfigError(toDescription(result.error));
  }
  return toConfig(result.data);
}

/**
 * Whether a value is one of the configured categories. Proposals are constrained
 * to this list, so a model cannot invent a category the budget does not have
 * (`specs/budget-matching` — "Proposed category must be a configured one").
 */
export function isConfiguredCategory(config: Config, value: string): boolean {
  return config.categories.includes(value);
}

/** Whether a value is one of the configured currency options. */
export function isConfiguredCurrency(config: Config, value: string): boolean {
  return config.currencies.includes(value);
}
