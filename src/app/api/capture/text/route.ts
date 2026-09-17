import { failureResponse, guard, jsonResponse, optionalString, parseJsonBody } from '@/api/handler';
import { getDraftService } from '@/runtime';

/**
 * Capture a spend from typed text.
 *
 * Returns a draft for review and writes nothing. The rate limit applies here
 * because this is where money is spent on the model.
 */
export async function POST(request: Request): Promise<Response> {
  try {
    const guarded = await guard(request, { rateLimit: true });
    if (!guarded.ok) {
      return guarded.response;
    }

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }

    const text = optionalString(parsed.body, 'text');
    if (text === undefined) {
      return jsonResponse(
        {
          error: {
            kind: 'empty-input',
            message: 'Type what you spent, including the amount.',
          },
        },
        400,
      );
    }

    const record = await getDraftService().captureFromText({
      text,
      draftId: optionalString(parsed.body, 'draftId'),
    });

    return jsonResponse({ draftId: record.id, draft: record.draft }, 201);
  } catch (error) {
    return failureResponse(error);
  }
}
