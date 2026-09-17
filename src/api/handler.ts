import { IdentityUnavailableError, type Identity, UnauthorisedError } from '@/auth/identity';
import { ConfirmError, InvalidDraftEditError, UnknownDraftError } from '@/drafts/service';
import { ExtractionError } from '@/extract/draft';
import {
  NotionError,
  NotionRelationTargetMissingError,
  NotionUnauthorisedError,
  NotionUnreachableError,
} from '@/notion/errors';
import { getIdentityResolver, getRateLimiter } from '@/runtime';

/**
 * The two things every request must get past before it can do anything:
 * a verified identity, and — on the endpoints that cost money — the ceiling.
 */

export type Guarded = { ok: true; identity: Identity } | { ok: false; response: Response };

export interface GuardOptions {
  /** Capture endpoints call the model, so they spend money and count. */
  rateLimit?: boolean;
}

export async function guard(request: Request, options: GuardOptions = {}): Promise<Guarded> {
  let identity: Identity;
  try {
    identity = await getIdentityResolver().resolve(request);
  } catch (error) {
    if (error instanceof UnauthorisedError || error instanceof IdentityUnavailableError) {
      return { ok: false, response: failureResponse(error) };
    }
    throw error;
  }

  if (options.rateLimit === true) {
    const result = getRateLimiter().consume(identity.email);
    if (!result.allowed) {
      return {
        ok: false,
        response: jsonResponse(
          {
            error: {
              kind: 'rate-limited',
              message: `That is ${result.used} captures today, past the daily ceiling of ${result.limit}. Resets tomorrow.`,
              limit: result.limit,
              used: result.used,
              day: result.day,
            },
          },
          429,
        ),
      };
    }
  }

  return { ok: true, identity };
}

export function jsonResponse(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

export type ParsedBody =
  { ok: true; body: Record<string, unknown> } | { ok: false; response: Response };

export async function parseJsonBody(request: Request): Promise<ParsedBody> {
  try {
    const body = (await request.json()) as unknown;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('not an object');
    }
    return { ok: true, body: body as Record<string, unknown> };
  } catch {
    return {
      ok: false,
      response: jsonResponse(
        { error: { kind: 'bad-request', message: 'Expected a JSON object.' } },
        400,
      ),
    };
  }
}

/** Reads an optional non-empty string field. */
export function optionalString(body: Record<string, unknown>, field: string): string | undefined {
  const value = body[field];
  return typeof value === 'string' && value.trim() !== '' ? value : undefined;
}

/**
 * Turns a thrown failure into a response.
 *
 * Every case is mapped deliberately: a missing draft is not a Notion outage, an
 * unsupported image is the caller's problem rather than ours, and a write that
 * did not happen must say so rather than reporting a generic error the user
 * cannot act on.
 */
export function failureResponse(error: unknown): Response {
  if (error instanceof UnauthorisedError) {
    return jsonResponse(
      { error: { kind: 'unauthorised', message: 'Sign in to use this app.' } },
      401,
    );
  }

  if (error instanceof IdentityUnavailableError) {
    // Not a 401: telling someone to sign in again is useless advice when the
    // problem is that Access could not be reached to check their token.
    return jsonResponse(
      {
        error: {
          kind: 'identity-unavailable',
          message:
            'Could not check your sign-in just now. Nothing was written — try again in a moment.',
          retryable: true,
        },
      },
      503,
    );
  }

  if (error instanceof UnknownDraftError) {
    return jsonResponse(
      {
        error: {
          kind: 'unknown-draft',
          message:
            'That draft is gone — it may have expired, or the server may have restarted. Capture the spend again.',
        },
      },
      404,
    );
  }

  if (error instanceof InvalidDraftEditError) {
    return jsonResponse({ error: { kind: 'invalid-edit', message: error.message } }, 400);
  }

  if (error instanceof ExtractionError) {
    const status =
      error.failure === 'unsupported-format'
        ? 415
        : error.failure === 'model-unreachable' || error.failure === 'invalid-response'
          ? 502
          : 422;
    return jsonResponse(
      { error: { kind: error.failure, message: error.message, retryable: status === 502 } },
      status,
    );
  }

  if (error instanceof ConfirmError) {
    // The draft is preserved either way, so retrying needs no re-entry.
    return jsonResponse(
      {
        error: {
          kind: 'write-failed',
          message: error.message,
          budgetLineCreated: error.budgetLineCreated,
          retryable: true,
        },
      },
      502,
    );
  }

  if (error instanceof NotionRelationTargetMissingError) {
    return jsonResponse(
      {
        error: {
          kind: 'budget-line-missing',
          message: 'That budget line no longer exists. Choose another one and try again.',
          retryable: false,
        },
      },
      409,
    );
  }

  if (error instanceof NotionError) {
    const unreachable = error instanceof NotionUnreachableError;
    const misconfigured = error instanceof NotionUnauthorisedError;
    return jsonResponse(
      {
        error: {
          kind: misconfigured ? 'notion-unauthorised' : 'notion-failed',
          message: misconfigured
            ? 'Notion refused the server’s credentials.'
            : 'Notion could not be reached. Nothing was written.',
          retryable: true,
        },
      },
      unreachable || misconfigured ? 503 : 502,
    );
  }

  return jsonResponse(
    { error: { kind: 'internal', message: 'Something went wrong. Nothing was written.' } },
    500,
  );
}
