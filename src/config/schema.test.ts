import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  configKeys,
  isConfiguredCategory,
  isConfiguredCurrency,
  MINIMUM_NOTION_VERSION,
  parseConfig,
} from './schema';
import { validEnv } from './test-env';

describe('valid configuration', () => {
  it('parses and exposes the binding the app needs', () => {
    const config = parseConfig(validEnv());

    expect(config.notion.budgetDataSourceId).toBe('3ca86094-f992-8055-943e-000b8fecdada');
    expect(config.notion.spendingDataSourceId).toBe('3ca86094-f992-809a-9ca6-000bea693d94');
    expect(config.notion.properties.spendingBudgetRelation).toBe('💸 Budget');
    expect(config.notion.version).toBe(MINIMUM_NOTION_VERSION);
  });

  it('splits the comma-separated lists and trims them', () => {
    const config = parseConfig({
      ...validEnv(),
      NOTION_CATEGORIES: 'Accomodation,Food , Tours',
      NOTION_CURRENCIES: 'EURO,AUD',
    });

    expect(config.categories).toEqual(['Accomodation', 'Food', 'Tours']);
    expect(config.currencies).toEqual(['EURO', 'AUD']);
  });

  it('preserves the literal spelling of select options', () => {
    // `Accomodation` is how the live budget spells it. Changing it to
    // `Accommodation` would make every write to that option fail.
    const config = parseConfig(validEnv());

    expect(config.categories).toContain('Accomodation');
    expect(config.categories).not.toContain('Accommodation');
    expect(config.currencies).toContain('EURO');
    expect(config.currencies).not.toContain('EUR');
  });

  it('defaults APP_ENV and DEV_AUTH_BYPASS when they are absent', () => {
    const env = validEnv();
    delete env.APP_ENV;
    delete env.DEV_AUTH_BYPASS;

    const config = parseConfig(env);

    expect(config.appEnv).toBe('development');
    expect(config.access.devBypass).toBe(false);
  });

  it('reads DEV_AUTH_BYPASS as a boolean rather than a truthy string', () => {
    // `z.coerce.boolean()` would read the string "false" as true.
    expect(parseConfig({ ...validEnv(), DEV_AUTH_BYPASS: 'false' }).access.devBypass).toBe(false);
    expect(parseConfig({ ...validEnv(), DEV_AUTH_BYPASS: 'true' }).access.devBypass).toBe(true);
  });
});

describe('a config missing a required value', () => {
  it.each([
    'NOTION_TOKEN',
    'NOTION_BUDGET_DATA_SOURCE_ID',
    'NOTION_SPENDING_DATA_SOURCE_ID',
    'NOTION_BUDGET_CATEGORY_PROPERTY',
    'NOTION_CURRENCIES',
    'DEFAULT_CURRENCY',
    'TRIP_TIMEZONE',
    'DEEPSEEK_API_KEY',
    'DEEPSEEK_MODEL_ID',
    'CF_ACCESS_AUD',
    'CAPTURE_DAILY_LIMIT',
  ])('names %s in the error', (key) => {
    const env = validEnv();
    delete env[key];

    expect(() => parseConfig(env)).toThrow(ConfigError);
    expect(() => parseConfig(env)).toThrow(new RegExp(key));
  });

  it('names a value that is present but blank', () => {
    expect(() => parseConfig({ ...validEnv(), NOTION_TOKEN: '   ' })).toThrow(/NOTION_TOKEN/);
  });

  it('reports every problem at once rather than only the first', () => {
    const env = validEnv();
    delete env.NOTION_TOKEN;
    delete env.DEEPSEEK_API_KEY;

    let message = '';
    try {
      parseConfig(env);
    } catch (error) {
      message = (error as Error).message;
    }

    expect(message).toMatch(/NOTION_TOKEN/);
    expect(message).toMatch(/DEEPSEEK_API_KEY/);
  });
});

describe('an unknown category', () => {
  it('is not one of the configured categories', () => {
    const config = parseConfig(validEnv());

    expect(isConfiguredCategory(config, 'Food')).toBe(true);
    expect(isConfiguredCategory(config, 'Scuba')).toBe(false);
    expect(isConfiguredCategory(config, 'Accommodation')).toBe(false);
  });

  it('is recognised once the configuration lists it', () => {
    // Reconfiguration, not a code change, is what makes a category valid.
    const config = parseConfig({ ...validEnv(), NOTION_CATEGORIES: 'Accomodation, Food, Scuba' });

    expect(isConfiguredCategory(config, 'Scuba')).toBe(true);
  });

  it('refuses a config whose default currency is not in its currency options', () => {
    expect(() => parseConfig({ ...validEnv(), DEFAULT_CURRENCY: 'USD' })).toThrow(
      /DEFAULT_CURRENCY/,
    );
    expect(() => parseConfig({ ...validEnv(), DEFAULT_CURRENCY: 'USD' })).toThrow(
      /USD|configured currencies/,
    );
  });

  it('recognises only the configured currencies', () => {
    const config = parseConfig(validEnv());

    expect(isConfiguredCurrency(config, 'EURO')).toBe(true);
    expect(isConfiguredCurrency(config, 'USD')).toBe(false);
  });
});

describe('values that are present but wrong', () => {
  it('refuses a Notion version older than data_source_id addressing needs', () => {
    expect(() => parseConfig({ ...validEnv(), NOTION_VERSION: '2022-06-28' })).toThrow(
      /NOTION_VERSION/,
    );
    expect(() => parseConfig({ ...validEnv(), NOTION_VERSION: '2022-06-28' })).toThrow(
      new RegExp(MINIMUM_NOTION_VERSION),
    );
  });

  it('accepts a later Notion version', () => {
    expect(parseConfig({ ...validEnv(), NOTION_VERSION: '2025-11-01' }).notion.version).toBe(
      '2025-11-01',
    );
  });

  it('refuses a timezone that is not a real zone', () => {
    expect(() => parseConfig({ ...validEnv(), TRIP_TIMEZONE: 'Mars/Olympus' })).toThrow(
      /TRIP_TIMEZONE/,
    );
  });

  it('refuses a non-numeric capture ceiling', () => {
    expect(() => parseConfig({ ...validEnv(), CAPTURE_DAILY_LIMIT: 'lots' })).toThrow(
      /CAPTURE_DAILY_LIMIT/,
    );
    expect(() => parseConfig({ ...validEnv(), CAPTURE_DAILY_LIMIT: '0' })).toThrow(
      /CAPTURE_DAILY_LIMIT/,
    );
  });

  it('refuses an unknown APP_ENV', () => {
    expect(() => parseConfig({ ...validEnv(), APP_ENV: 'staging' })).toThrow(/APP_ENV/);
  });
});

describe('.env.example', () => {
  it('lists exactly the variables the schema requires, so the two cannot drift', () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

    const declared = example
      .split('\n')
      .map((line) => /^([A-Z][A-Z0-9_]*)=/.exec(line.trim()))
      .filter((match): match is RegExpExecArray => match !== null)
      .map((match) => match[1]);

    expect(new Set(declared)).toEqual(new Set(configKeys));
  });

  it('carries no real values', () => {
    const example = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');

    // Every credential-shaped variable is left blank in the template.
    for (const key of ['NOTION_TOKEN', 'DEEPSEEK_API_KEY', 'CF_ACCESS_AUD']) {
      expect(example).toMatch(new RegExp(`^${key}=\\s*$`, 'm'));
    }
  });
});
