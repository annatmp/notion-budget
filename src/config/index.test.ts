import { afterEach, describe, expect, it } from 'vitest';

import { ConfigError, loadConfig, resetConfigCache } from './index';
import { validEnv } from './test-env';

afterEach(() => {
  resetConfigCache();
});

describe('loadConfig', () => {
  it('returns a usable config for a complete environment', () => {
    const config = loadConfig(validEnv());

    expect(config.defaultCurrency).toBe('AUD');
    expect(config.timezone).toBe('Australia/Melbourne');
    expect(config.deepseek.modelId).toBe('deepseek-flash');
  });

  it('refuses to start on an incomplete environment, naming the value', () => {
    const env = validEnv();
    delete env.NOTION_BUDGET_DATA_SOURCE_ID;

    expect(() => loadConfig(env)).toThrow(ConfigError);
    expect(() => loadConfig(env)).toThrow(/NOTION_BUDGET_DATA_SOURCE_ID/);
  });

  it('names the value when it is present but blank', () => {
    expect(() => loadConfig({ ...validEnv(), DEEPSEEK_API_KEY: '' })).toThrow(/DEEPSEEK_API_KEY/);
  });

  it('reads the real environment by default', () => {
    // No argument means `process.env`, which the test runner has not populated
    // with a budget binding, so this is the startup refusal in its real form.
    expect(() => loadConfig()).toThrow(ConfigError);
    expect(() => loadConfig()).toThrow(/NOTION_TOKEN/);
  });

  it('parses once and reuses the result', () => {
    const first = loadConfig(validEnv());
    const second = loadConfig({ ...validEnv(), DEFAULT_CURRENCY: 'EUR' });

    // The second call is ignored: configuration is read at startup, not per
    // request, so a later environment change cannot half-apply.
    expect(second).toBe(first);
    expect(second.defaultCurrency).toBe('AUD');
  });

  it('re-parses after the cache is reset', () => {
    loadConfig(validEnv());
    resetConfigCache();

    const reloaded = loadConfig({ ...validEnv(), DEFAULT_CURRENCY: 'EURO' });

    expect(reloaded.defaultCurrency).toBe('EURO');
  });
});
