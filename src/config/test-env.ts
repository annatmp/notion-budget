/**
 * A complete, valid environment for tests. Test-only — nothing in the
 * application imports this.
 *
 * Kept in one place so the schema tests and the loader tests cannot disagree
 * about what "valid" means. Individual tests spoil one value at a time.
 */
export function validEnv(): Record<string, string> {
  return {
    NOTION_TOKEN: 'ntn_test_token',
    NOTION_VERSION: '2025-09-03',
    NOTION_BUDGET_DATA_SOURCE_ID: '3ca86094-f992-8055-943e-000b8fecdada',
    NOTION_SPENDING_DATA_SOURCE_ID: '3ca86094-f992-809a-9ca6-000bea693d94',
    NOTION_BUDGET_TITLE_PROPERTY: 'Item',
    NOTION_BUDGET_CATEGORY_PROPERTY: 'Category',
    NOTION_SPENDING_TITLE_PROPERTY: 'Name',
    NOTION_SPENDING_PRICE_PROPERTY: 'Price',
    NOTION_SPENDING_CURRENCY_PROPERTY: 'Currency',
    NOTION_SPENDING_DATE_PROPERTY: 'Date paid/to be paid',
    NOTION_SPENDING_BUDGET_RELATION_PROPERTY: '💸 Budget',
    NOTION_CATEGORIES: 'Accomodation, Food, Tours, Activity, Transport, Flights, Misc, Full Trip',
    // `EURO`, not `EUR`: matched literally against the budget's select options.
    NOTION_CURRENCIES: 'EURO, AUD',
    DEFAULT_CURRENCY: 'AUD',
    TRIP_TIMEZONE: 'Australia/Melbourne',
    DEEPSEEK_API_KEY: 'sk-test-key',
    DEEPSEEK_MODEL_ID: 'deepseek-flash',
    CF_ACCESS_TEAM_DOMAIN: 'example.cloudflareaccess.com',
    CF_ACCESS_AUD: 'test-audience-tag',
    DEV_AUTH_BYPASS: 'false',
    CAPTURE_DAILY_LIMIT: '200',
    APP_ENV: 'development',
  };
}
