import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

import {
  ConfigError,
  configKeys,
  DEFAULT_CAPTURE_DAILY_LIMIT,
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
    expect(config.access.mode).toBe('access');
  });

  it('reads DEV_AUTH_BYPASS as a boolean rather than a truthy string', () => {
    // `z.coerce.boolean()` would read the string "false" as true.
    expect(parseConfig({ ...validEnv(), DEV_AUTH_BYPASS: 'false' }).access.mode).toBe('access');
    expect(parseConfig({ ...validEnv(), DEV_AUTH_BYPASS: 'true' }).access.mode).toBe('bypass');
  });
});

describe('a prototype with no Cloudflare account yet', () => {
  it('starts with the bypass on and no Access values at all', () => {
    // The whole point of the bypass: Cloudflare is a deployment-time concern, so
    // building the prototype does not require an account, a domain or a tunnel.
    const env = validEnv();
    env.DEV_AUTH_BYPASS = 'true';
    env.CF_ACCESS_TEAM_DOMAIN = '';
    env.CF_ACCESS_AUD = '';

    const config = parseConfig(env);

    expect(config.access).toEqual({ mode: 'bypass' });
  });

  it('requires both Access values once the bypass is off', () => {
    const withoutTeamDomain = { ...validEnv(), CF_ACCESS_TEAM_DOMAIN: '' };
    const withoutAudience = { ...validEnv(), CF_ACCESS_AUD: '' };

    expect(() => parseConfig(withoutTeamDomain)).toThrow(/CF_ACCESS_TEAM_DOMAIN/);
    expect(() => parseConfig(withoutAudience)).toThrow(/CF_ACCESS_AUD/);
  });

  it('says how to satisfy the requirement', () => {
    const env = { ...validEnv(), CF_ACCESS_TEAM_DOMAIN: '', CF_ACCESS_AUD: '' };

    expect(() => parseConfig(env)).toThrow(/unless DEV_AUTH_BYPASS=true/);
  });
});

describe('the local auth bypass', () => {
  it('is carried into the config as a mode, not a flag beside two empty strings', () => {
    const config = parseConfig({ ...validEnv(), DEV_AUTH_BYPASS: 'true' });

    expect(config.access.mode).toBe('bypass');
    expect(config.access).not.toHaveProperty('teamDomain');
  });

  it('refuses to start under a production APP_ENV', () => {
    // The one failure that looks like success: the app would accept requests
    // whose identity it has never verified.
    expect(() =>
      parseConfig({ ...validEnv(), DEV_AUTH_BYPASS: 'true', APP_ENV: 'production' }),
    ).toThrow(/DEV_AUTH_BYPASS/);
  });

  it('names the reason rather than just the field', () => {
    expect(() =>
      parseConfig({ ...validEnv(), DEV_AUTH_BYPASS: 'true', APP_ENV: 'production' }),
    ).toThrow(/unverified requests/);
  });

  it('is allowed in development and test', () => {
    expect(() =>
      parseConfig({ ...validEnv(), DEV_AUTH_BYPASS: 'true', APP_ENV: 'development' }),
    ).not.toThrow();
    expect(() =>
      parseConfig({ ...validEnv(), DEV_AUTH_BYPASS: 'true', APP_ENV: 'test' }),
    ).not.toThrow();
  });

  it('leaves a bypassed config without Access values usable at the default ceiling', () => {
    const env = validEnv();
    env.DEV_AUTH_BYPASS = 'true';
    env.CF_ACCESS_TEAM_DOMAIN = '';
    env.CF_ACCESS_AUD = '';
    delete env.CAPTURE_DAILY_LIMIT;

    const config = parseConfig(env);

    expect(config.captureDailyLimit).toBe(DEFAULT_CAPTURE_DAILY_LIMIT);
  });
});

describe('the Access team domain', () => {
  it('has its scheme filled in when it was left off', () => {
    // The same value is compared against the token's `iss` claim, which always
    // carries the scheme — so a bare hostname would never verify.
    const config = parseConfig({
      ...validEnv(),
      CF_ACCESS_TEAM_DOMAIN: 'anna.cloudflareaccess.com',
    });

    expect(config.access).toEqual({
      mode: 'access',
      teamDomain: 'https://anna.cloudflareaccess.com',
      audience: 'test-audience-tag',
    });
  });

  it('is left alone when the scheme is already there', () => {
    const config = parseConfig({
      ...validEnv(),
      CF_ACCESS_TEAM_DOMAIN: 'https://anna.cloudflareaccess.com',
    });

    expect(config.access).toMatchObject({ teamDomain: 'https://anna.cloudflareaccess.com' });
  });

  it('refuses a plain http team domain', () => {
    expect(() =>
      parseConfig({ ...validEnv(), CF_ACCESS_TEAM_DOMAIN: 'http://anna.cloudflareaccess.com' }),
    ).toThrow(/CF_ACCESS_TEAM_DOMAIN/);
  });

  it('refuses something that is not a URL at all', () => {
    expect(() => parseConfig({ ...validEnv(), CF_ACCESS_TEAM_DOMAIN: 'not a domain' })).toThrow(
      /CF_ACCESS_TEAM_DOMAIN/,
    );
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
