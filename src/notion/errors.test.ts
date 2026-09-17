import { describe, expect, it } from 'vitest';

import {
  networkFailure,
  NotionError,
  notionFailure,
  NotionRelationTargetMissingError,
  NotionUnauthorisedError,
  NotionUnreachableError,
  NotionWriteRejectedError,
} from './errors';

const relation = '💸 Budget';

describe('each Notion failure maps to its own error', () => {
  it('gives the four failures four distinct types, not one generic failure', () => {
    const failures = {
      unreachable: notionFailure(503, {}, { kind: 'read' }),
      unauthorised: notionFailure(401, {}, { kind: 'read' }),
      rejected: notionFailure(
        400,
        { code: 'validation_error', message: 'Price is expected to be a number' },
        { kind: 'write', relationProperty: relation },
      ),
      relationGone: notionFailure(
        400,
        { code: 'validation_error', message: '"💸 Budget" is not a valid relation' },
        { kind: 'write', relationProperty: relation },
      ),
    };

    const types = Object.values(failures).map((error) => error.constructor);
    expect(new Set(types).size).toBe(4);

    expect(failures.unreachable).toBeInstanceOf(NotionUnreachableError);
    expect(failures.unauthorised).toBeInstanceOf(NotionUnauthorisedError);
    expect(failures.rejected).toBeInstanceOf(NotionWriteRejectedError);
    expect(failures.relationGone).toBeInstanceOf(NotionRelationTargetMissingError);
  });

  it('keeps them all under one base class', () => {
    expect(notionFailure(500, {}, { kind: 'read' })).toBeInstanceOf(NotionError);
    expect(notionFailure(403, {}, { kind: 'read' })).toBeInstanceOf(NotionError);
    expect(notionFailure(422, {}, { kind: 'write' })).toBeInstanceOf(NotionError);
  });

  it('treats an expired or under-scoped token as unauthorised either way', () => {
    expect(notionFailure(401, { code: 'unauthorized' }, { kind: 'read' })).toBeInstanceOf(
      NotionUnauthorisedError,
    );
    expect(notionFailure(403, { code: 'restricted_resource' }, { kind: 'read' })).toBeInstanceOf(
      NotionUnauthorisedError,
    );
  });

  it('names the token and the sharing requirement in the unauthorised message', () => {
    const error = notionFailure(403, {}, { kind: 'read' });

    expect(error.message).toMatch(/NOTION_TOKEN/);
    expect(error.message).toMatch(/shared with the integration/);
  });

  it('treats a flat refusal as a rejected write, not a dangling relation', () => {
    // The write was rejected, but nothing suggests the relation is the reason.
    const error = notionFailure(
      400,
      { code: 'validation_error', message: 'Currency is not a valid select option' },
      { kind: 'write', relationProperty: relation },
    );

    expect(error).toBeInstanceOf(NotionWriteRejectedError);
    expect(error).not.toBeInstanceOf(NotionRelationTargetMissingError);
  });

  it('does not mistake a read failure for a dangling relation', () => {
    // A 400 mentioning a relation during a read is not a write problem.
    const error = notionFailure(
      400,
      { code: 'validation_error', message: 'relation filter is malformed' },
      { kind: 'read', relationProperty: relation },
    );

    expect(error).toBeInstanceOf(NotionWriteRejectedError);
  });

  it('treats rate limiting and 5xx as "not right now", preserving the status', () => {
    const limited = notionFailure(429, {}, { kind: 'read' });
    const down = notionFailure(502, {}, { kind: 'read' });

    expect(limited).toBeInstanceOf(NotionUnreachableError);
    expect(down).toBeInstanceOf(NotionUnreachableError);
    expect(limited.status).toBe(429);
    expect(down.status).toBe(502);
  });

  it('calls a missing data source on a read unreachable, not a rejected write', () => {
    const error = notionFailure(404, { code: 'object_not_found' }, { kind: 'read' });

    expect(error).toBeInstanceOf(NotionUnreachableError);
    expect(error.message).toMatch(/data source/i);
  });

  it('preserves Notion\u2019s own message so the log says why', () => {
    const error = notionFailure(
      400,
      { code: 'validation_error', message: 'Currency is not a valid select option' },
      { kind: 'write', relationProperty: relation },
    );

    expect(error.message).toContain('Currency is not a valid select option');
  });

  it('reports the status on every classified failure', () => {
    expect(notionFailure(401, {}, { kind: 'read' }).status).toBe(401);
    expect(notionFailure(400, {}, { kind: 'write' }).status).toBe(400);
  });
});

describe('a transport failure', () => {
  it('becomes unreachable and keeps the original cause', () => {
    const cause = new Error('getaddrinfo ENOTFOUND api.notion.com');
    const error = networkFailure(cause);

    expect(error).toBeInstanceOf(NotionUnreachableError);
    expect(error.cause).toBe(cause);
    expect(error.message).toContain('ENOTFOUND');
  });

  it('copes with a non-Error being thrown', () => {
    expect(networkFailure('boom').message).toContain('boom');
  });
});
