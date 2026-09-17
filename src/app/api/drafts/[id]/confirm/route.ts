import { failureResponse, guard, jsonResponse } from '@/api/handler';
import { getDraftService } from '@/runtime';

interface Context {
  params: Promise<{ id: string }>;
}

/**
 * The only endpoint that writes to Notion.
 *
 * Everything before this returns a draft; nothing is recorded until a person
 * has seen it and said yes. Repeating the call for a draft that already
 * succeeded returns the row written the first time rather than writing again.
 */
export async function POST(request: Request, context: Context): Promise<Response> {
  try {
    const guarded = await guard(request);
    if (!guarded.ok) {
      return guarded.response;
    }

    const { id } = await context.params;
    const result = await getDraftService().confirm(id);

    return jsonResponse({ recorded: true, ...result });
  } catch (error) {
    return failureResponse(error);
  }
}
