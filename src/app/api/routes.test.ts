import { beforeEach, describe, expect, it, vi } from 'vitest';

const resolver = { resolve: vi.fn() };
const limiter = { consume: vi.fn() };
const service = {
  captureFromText: vi.fn(),
  captureFromImage: vi.fn(),
  get: vi.fn(),
  edit: vi.fn(),
  confirm: vi.fn(),
  discard: vi.fn(),
  listBudgetLines: vi.fn(),
};

vi.mock('@/runtime', () => ({
  getIdentityResolver: () => resolver,
  getRateLimiter: () => limiter,
  getDraftService: () => service,
}));

vi.mock('@/config', () => ({
  loadConfig: () => ({
    categories: ['Accomodation', 'Food'],
    currencies: ['EURO', 'AUD'],
    defaultCurrency: 'AUD',
  }),
}));

const { POST: captureText } = await import('./capture/text/route');
const { POST: captureImage } = await import('./capture/image/route');
const { GET: getDraft, PATCH: editDraft } = await import('./drafts/[id]/route');
const { POST: confirmDraft } = await import('./drafts/[id]/confirm/route');
const { POST: discardDraft } = await import('./drafts/[id]/discard/route');
const { GET: budgetLines } = await import('./budget-lines/route');

const IDENTITY = { email: 'anna@example.com', source: 'access' as const };
const DRAFT = { description: 'Coffee', amount: 8 };

function post(body: unknown) {
  return new Request('http://localhost/api/capture/text', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
}

const context = { params: Promise.resolve({ id: 'draft-1' }) };

beforeEach(() => {
  vi.clearAllMocks();
  resolver.resolve.mockResolvedValue(IDENTITY);
  limiter.consume.mockReturnValue({ allowed: true, used: 1, limit: 200, day: '2026-09-17' });
  service.captureFromText.mockResolvedValue({ id: 'draft-1', draft: DRAFT });
  service.captureFromImage.mockResolvedValue({ id: 'draft-2', draft: DRAFT });
  service.get.mockReturnValue({ id: 'draft-1', draft: DRAFT, writtenSpendingRowId: null });
  service.edit.mockResolvedValue({ id: 'draft-1', draft: DRAFT });
  service.confirm.mockResolvedValue({
    spendingRowId: 'row-1',
    budgetLineId: 'line-1',
    budgetLineName: "Coffee's and snacks",
    amount: 8,
    currency: 'AUD',
    createdBudgetLine: false,
    written: true,
  });
  service.discard.mockReturnValue(true);
  service.listBudgetLines.mockResolvedValue([{ id: 'line-1', name: 'Food', category: 'Food' }]);
});

describe('an unverified caller', () => {
  it('gets a server error when identity resolution itself blew up, and does no work', async () => {
    resolver.resolve.mockRejectedValue(new Error('unexpected'));

    const response = await captureText(post({ text: 'coffee 8' }));

    // The security property is that no unverified request proceeds, which holds
    // even when the failure is unexpected rather than a clean refusal.
    expect(response.status).toBe(500);
    expect(service.captureFromText).not.toHaveBeenCalled();
  });

  it('is refused with a sign-in message when the identity is rejected', async () => {
    const { UnauthorisedError } = await import('@/auth/identity');
    resolver.resolve.mockRejectedValue(new UnauthorisedError('no token'));

    const response = await captureText(post({ text: 'coffee 8' }));

    expect(response.status).toBe(401);
    expect(await response.json()).toMatchObject({ error: { kind: 'unauthorised' } });
    expect(service.captureFromText).not.toHaveBeenCalled();
  });

  it('is told to retry, not to sign in, when Access could not be reached', async () => {
    const { IdentityUnavailableError } = await import('@/auth/identity');
    resolver.resolve.mockRejectedValue(new IdentityUnavailableError('timeout'));

    const response = await captureText(post({ text: 'coffee 8' }));

    expect(response.status).toBe(503);
    expect(await response.json()).toMatchObject({ error: { retryable: true } });
    expect(service.captureFromText).not.toHaveBeenCalled();
  });
});

describe('capture', () => {
  it('returns a draft for review', async () => {
    const response = await captureText(post({ text: 'coffee 8 bucks' }));

    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ draftId: 'draft-1', draft: DRAFT });
  });

  it('writes nothing', async () => {
    await captureText(post({ text: 'coffee 8 bucks' }));

    // Neither the review step nor the write step may be reached by capturing.
    expect(service.confirm).not.toHaveBeenCalled();
    expect(service.edit).not.toHaveBeenCalled();
  });

  it('counts against the daily ceiling, because it spends money', async () => {
    await captureText(post({ text: 'coffee 8 bucks' }));

    expect(limiter.consume).toHaveBeenCalledWith('anna@example.com');
  });

  it('refuses once the ceiling is reached, with a message that explains itself', async () => {
    limiter.consume.mockReturnValue({ allowed: false, used: 201, limit: 200, day: '2026-09-17' });

    const response = await captureText(post({ text: 'coffee 8 bucks' }));

    expect(response.status).toBe(429);
    const body = (await response.json()) as { error: { message: string; limit: number } };
    expect(body.error.message).toMatch(/201/);
    expect(body.error.message).toMatch(/200/);
    expect(body.error.limit).toBe(200);
    expect(service.captureFromText).not.toHaveBeenCalled();
  });

  it('refuses an empty spend rather than sending it to the model', async () => {
    const response = await captureText(post({ text: '   ' }));

    expect(response.status).toBe(400);
    expect(service.captureFromText).not.toHaveBeenCalled();
  });

  it('refuses a body that is not a JSON object', async () => {
    const response = await captureText(
      new Request('http://localhost/api/capture/text', { method: 'POST', body: 'not json' }),
    );

    expect(response.status).toBe(400);
    expect(service.captureFromText).not.toHaveBeenCalled();
  });

  it('passes an unsupported image back as the caller’s problem, not a server fault', async () => {
    const { ExtractionError } = await import('@/extract/draft');
    service.captureFromImage.mockRejectedValue(
      new ExtractionError('unsupported-format', 'That file type is not supported.'),
    );

    const response = await captureImage(post({ dataUrl: 'data:application/pdf;base64,AA' }));

    expect(response.status).toBe(415);
    expect(await response.json()).toMatchObject({ error: { kind: 'unsupported-format' } });
  });

  it('reports a model outage as retryable rather than as a broken app', async () => {
    const { ExtractionError } = await import('@/extract/draft');
    service.captureFromText.mockRejectedValue(
      new ExtractionError('model-unreachable', 'Could not reach the extraction model'),
    );

    const response = await captureText(post({ text: 'coffee 8' }));

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({ error: { retryable: true } });
  });

  it('asks for an amount when none could be read', async () => {
    const { ExtractionError } = await import('@/extract/draft');
    service.captureFromText.mockRejectedValue(
      new ExtractionError('no-amount', 'No amount could be read from that input.'),
    );

    const response = await captureText(post({ text: 'lunch somewhere nice' }));

    expect(response.status).toBe(422);
    expect(await response.json()).toMatchObject({ error: { kind: 'no-amount' } });
  });
});

describe('reviewing a draft', () => {
  it('loads it back, so a reload loses nothing', async () => {
    const response = await getDraft(post({}), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ draftId: 'draft-1' });
  });

  it('is not rate limited, because it costs nothing', async () => {
    await getDraft(post({}), context);

    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it('applies an edit and passes a chosen line through as the match', async () => {
    await editDraft(post({ amount: 34.2, budgetLineId: 'line-9' }), context);

    expect(service.edit).toHaveBeenCalledWith('draft-1', {
      amount: 34.2,
      match: expect.objectContaining({ kind: 'existing', lineId: 'line-9' }),
    });
  });

  it('ignores fields it does not own', async () => {
    await editDraft(post({ amount: 34.2, writtenSpendingRowId: 'row-9' }), context);

    expect(service.edit).toHaveBeenCalledWith('draft-1', { amount: 34.2 });
  });

  it('reports an expired draft as gone rather than as a server error', async () => {
    const { UnknownDraftError } = await import('@/drafts/service');
    service.edit.mockRejectedValue(new UnknownDraftError('draft-1'));

    const response = await editDraft(post({ amount: 1 }), context);

    expect(response.status).toBe(404);
  });
});

describe('confirming', () => {
  it('reports what was recorded', async () => {
    const response = await confirmDraft(post({}), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      recorded: true,
      spendingRowId: 'row-1',
      budgetLineName: "Coffee's and snacks",
      amount: 8,
    });
  });

  it('is not rate limited, so a retry after a failure is never blocked by the ceiling', async () => {
    await confirmDraft(post({}), context);

    expect(limiter.consume).not.toHaveBeenCalled();
  });

  it('says the expense was not recorded when the write failed', async () => {
    const { ConfirmError } = await import('@/drafts/service');
    service.confirm.mockRejectedValue(
      new ConfirmError('Not recorded — the expense was not written.', false),
    );

    const response = await confirmDraft(post({}), context);

    expect(response.status).toBe(502);
    expect(await response.json()).toMatchObject({
      error: { kind: 'write-failed', retryable: true, budgetLineCreated: false },
    });
  });

  it('says the budget line was created when only the row failed', async () => {
    const { ConfirmError } = await import('@/drafts/service');
    service.confirm.mockRejectedValue(
      new ConfirmError('Not recorded — the budget line was created.', true),
    );

    const response = await confirmDraft(post({}), context);

    expect(await response.json()).toMatchObject({
      error: { budgetLineCreated: true, retryable: true },
    });
  });
});

describe('discarding', () => {
  it('confirms the draft is gone without writing anything', async () => {
    const response = await discardDraft(post({}), context);

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ discarded: true });
    expect(service.confirm).not.toHaveBeenCalled();
  });
});

describe('the budget lines endpoint', () => {
  it('returns the lines with the budget’s vocabulary', async () => {
    const response = await budgetLines(post({}));

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      lines: [{ id: 'line-1', name: 'Food', category: 'Food' }],
      categories: ['Accomodation', 'Food'],
      currencies: ['EURO', 'AUD'],
      defaultCurrency: 'AUD',
    });
  });

  it('reports an unreachable budget rather than an empty line list', async () => {
    const { NotionUnreachableError } = await import('@/notion/errors');
    service.listBudgetLines.mockRejectedValue(new NotionUnreachableError('down'));

    const response = await budgetLines(post({}));

    // An empty list would read as "this budget has no lines", which is a
    // different and misleading claim.
    expect(response.status).toBe(503);
  });
});
