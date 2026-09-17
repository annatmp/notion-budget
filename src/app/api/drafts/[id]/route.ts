import { failureResponse, guard, jsonResponse, optionalString, parseJsonBody } from '@/api/handler';
import { type DraftEdit } from '@/drafts/service';
import { getDraftService } from '@/runtime';

interface Context {
  params: Promise<{ id: string }>;
}

/** Load a draft for review, so a reload or a lost connection loses nothing. */
export async function GET(request: Request, context: Context): Promise<Response> {
  try {
    const guarded = await guard(request);
    if (!guarded.ok) {
      return guarded.response;
    }

    const { id } = await context.params;
    const record = getDraftService().get(id);

    return jsonResponse({
      draftId: record.id,
      draft: record.draft,
      writtenSpendingRowId: record.writtenSpendingRowId,
    });
  } catch (error) {
    return failureResponse(error);
  }
}

/**
 * Apply the user's edits.
 *
 * This re-runs no extraction: the user is correcting what the model produced,
 * so calling the model again would discard their correction and cost another
 * round trip.
 */
export async function PATCH(request: Request, context: Context): Promise<Response> {
  try {
    const guarded = await guard(request);
    if (!guarded.ok) {
      return guarded.response;
    }

    const parsed = await parseJsonBody(request);
    if (!parsed.ok) {
      return parsed.response;
    }

    const { id } = await context.params;
    const changes: DraftEdit = {};

    if (typeof parsed.body.description === 'string') {
      changes.description = parsed.body.description;
    }
    if (typeof parsed.body.amount === 'number') {
      changes.amount = parsed.body.amount;
    }
    if (typeof parsed.body.currency === 'string') {
      changes.currency = parsed.body.currency;
    }
    if (typeof parsed.body.date === 'string') {
      changes.date = parsed.body.date;
    }

    // Choosing a line replaces the match. The name is filled in from the
    // budget during validation, so it need not be supplied here.
    const budgetLineId = optionalString(parsed.body, 'budgetLineId');
    if (budgetLineId !== undefined) {
      changes.match = {
        kind: 'existing',
        lineId: budgetLineId,
        lineName: '',
        confidence: 'high',
        reason: 'Chosen by the user',
        alternatives: [],
      };
    }

    const record = await getDraftService().edit(id, changes);

    return jsonResponse({ draftId: record.id, draft: record.draft });
  } catch (error) {
    return failureResponse(error);
  }
}
