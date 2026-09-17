import { failureResponse, guard, jsonResponse, optionalString, parseJsonBody } from '@/api/handler';
import { getDraftService } from '@/runtime';

/**
 * Capture a spend from a receipt photograph.
 *
 * The image arrives as a base64 data URL, so the receipt is never made publicly
 * addressable. As with text capture, this returns a draft and writes nothing.
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

    const dataUrl = optionalString(parsed.body, 'dataUrl');
    if (dataUrl === undefined) {
      return jsonResponse(
        { error: { kind: 'empty-input', message: 'No image was received.' } },
        400,
      );
    }

    const record = await getDraftService().captureFromImage({
      dataUrl,
      caption: optionalString(parsed.body, 'caption'),
      draftId: optionalString(parsed.body, 'draftId'),
    });

    return jsonResponse({ draftId: record.id, draft: record.draft }, 201);
  } catch (error) {
    return failureResponse(error);
  }
}
