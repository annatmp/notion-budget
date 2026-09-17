import { failureResponse, guard, jsonResponse } from '@/api/handler';
import { getDraftService } from '@/runtime';

interface Context {
  params: Promise<{ id: string }>;
}

/**
 * Throw the draft away.
 *
 * Nothing was written, so there is nothing to undo — this only forgets it, and
 * does so without complaining if it had already expired.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const guarded = await guard(request);
    if (!guarded.ok) {
      return guarded.response;
    }

    const { id } = await context.params;
    getDraftService().discard(id);

    return jsonResponse({ discarded: true });
  } catch (error) {
    return failureResponse(error);
  }
}
