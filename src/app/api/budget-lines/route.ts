import { failureResponse, guard, jsonResponse } from '@/api/handler';
import { loadConfig } from '@/config';
import { getDraftService } from '@/runtime';

/**
 * The budget's current lines, categories and currencies.
 *
 * Feeds the override picker, so a user can always search the full set and
 * choose a different line from the one matched. Read fresh on each request, so
 * a line the other person just created is selectable straight away.
 */
export async function GET(request: Request): Promise<Response> {
  try {
    const guarded = await guard(request);
    if (!guarded.ok) {
      return guarded.response;
    }

    const config = loadConfig();
    const lines = await getDraftService().listBudgetLines();

    return jsonResponse({
      lines,
      categories: config.categories,
      currencies: config.currencies,
      defaultCurrency: config.defaultCurrency,
    });
  } catch (error) {
    return failureResponse(error);
  }
}
