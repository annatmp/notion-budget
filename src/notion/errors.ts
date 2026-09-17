/**
 * The distinct ways a Notion call can fail.
 *
 * `specs/notion-integration` requires that a caller can tell these apart — "Budget
 * data source unreachable" and "Write fails" are different problems with
 * different remedies, and one generic error would collapse "your token was
 * revoked" into "try again later".
 */

export interface NotionFailureBody {
  code?: string;
  message?: string;
}

/** Base class, so a caller can catch every Notion failure at once. */
export class NotionError extends Error {
  readonly status: number | undefined;

  constructor(message: string, options: { status?: number; cause?: unknown } = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.status = options.status;
  }
}

/** No usable answer: the request never arrived, or Notion is not serving. */
export class NotionUnreachableError extends NotionError {}

/** Notion answered and refused us — bad, revoked, or under-scoped token. */
export class NotionUnauthorisedError extends NotionError {}

/** Notion answered and rejected the write itself. */
export class NotionWriteRejectedError extends NotionError {}

/**
 * The relation points at a budget line that no longer exists. Distinct from a
 * generic rejection because the remedy differs: the user picks another line
 * rather than retrying (`design.md` — "Budget lines change while a draft is
 * open").
 */
export class NotionRelationTargetMissingError extends NotionError {}

export interface FailureContext {
  kind: 'read' | 'write';
  /** The configured relation property, used to recognise a dangling relation. */
  relationProperty?: string;
}

/** Whether a rejection appears to be about the relation rather than a field. */
function mentionsRelation(body: NotionFailureBody | undefined, relationProperty?: string) {
  const message = (body?.message ?? '').toLowerCase();
  if (message === '') {
    return false;
  }
  if (message.includes('relation')) {
    return true;
  }
  return relationProperty !== undefined && message.includes(relationProperty.toLowerCase());
}

/**
 * Maps an HTTP response onto the error that describes it.
 *
 * Deliberate bucketing: 429 and 5xx become `NotionUnreachableError`, because to
 * a caller they mean the same thing — the budget cannot be read or written right
 * now, and retrying later is the remedy. The status is preserved on the error
 * for logging.
 */
export function notionFailure(
  status: number,
  body: NotionFailureBody | undefined,
  context: FailureContext,
): NotionError {
  const detail = body?.message === undefined ? '' : `: ${body.message}`;

  if (status === 401 || status === 403) {
    return new NotionUnauthorisedError(
      `Notion refused the request (${status})${detail}. Check NOTION_TOKEN and that both databases are shared with the integration.`,
      { status },
    );
  }

  if (status === 429 || status >= 500) {
    return new NotionUnreachableError(
      `Notion is not serving requests right now (${status})${detail}`,
      { status },
    );
  }

  if (status === 400 || status === 409 || status === 422) {
    if (context.kind === 'write' && mentionsRelation(body, context.relationProperty)) {
      return new NotionRelationTargetMissingError(
        `The budget line this expense relates to no longer exists${detail}`,
        { status },
      );
    }
    return new NotionWriteRejectedError(`Notion rejected the write (${status})${detail}`, {
      status,
    });
  }

  if (status === 404) {
    return context.kind === 'write'
      ? new NotionRelationTargetMissingError(
          `Notion could not find the target of this write (404)${detail}`,
          { status },
        )
      : new NotionUnreachableError(
          `The configured data source could not be found (404)${detail}. Check the data source IDs and that the integration is shared with them.`,
          { status },
        );
  }

  return new NotionUnreachableError(`Notion request failed (${status})${detail}`, { status });
}

/** Wraps a transport-level failure, which arrives as a thrown error, not a status. */
export function networkFailure(cause: unknown): NotionUnreachableError {
  const detail = cause instanceof Error ? cause.message : String(cause);
  return new NotionUnreachableError(`Could not reach Notion: ${detail}`, { cause });
}
