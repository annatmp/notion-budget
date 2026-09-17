import type { DraftExpense } from '@/extract/draft';

/**
 * A draft awaiting confirmation, plus the two identifiers that make a retry safe.
 *
 * Notion offers no idempotency key, so the server records what it has already
 * created: `createdBudgetLineId` so a retry after a partial failure relates the
 * expense to the line that already exists instead of creating a duplicate, and
 * `writtenSpendingRowId` so a confirm that already succeeded returns that row
 * rather than writing a second one (`design.md` — "Server-held draft state").
 */
export interface StoredDraft {
  readonly id: string;
  draft: DraftExpense;
  readonly createdAt: number;
  createdBudgetLineId: string | null;
  writtenSpendingRowId: string | null;
}

export interface DraftPatch {
  draft?: DraftExpense;
  createdBudgetLineId?: string | null;
  writtenSpendingRowId?: string | null;
}

/** Long enough to survive a night, short enough that abandoned drafts do not accumulate. */
export const DEFAULT_DRAFT_TTL_MS = 12 * 60 * 60 * 1000;

/**
 * Drafts held in memory, keyed by a client-generated id.
 *
 * In memory on purpose: a restart loses unconfirmed drafts, which is an
 * annoyance rather than data loss, because nothing unconfirmed was ever written.
 * The alternative — client-held state — would let the client assert that a row
 * was already written, which is exactly the claim that must not be forgeable.
 */
export class DraftStore {
  private readonly drafts = new Map<string, StoredDraft>();

  constructor(
    private readonly ttlMs: number = DEFAULT_DRAFT_TTL_MS,
    private readonly now: () => number = () => Date.now(),
  ) {}

  put(id: string, draft: DraftExpense): StoredDraft {
    this.purgeExpired();

    const record: StoredDraft = {
      id,
      draft,
      createdAt: this.now(),
      createdBudgetLineId: null,
      writtenSpendingRowId: null,
    };
    this.drafts.set(id, record);
    return record;
  }

  /** Returns the draft, or `undefined` when it is unknown or has expired. */
  get(id: string): StoredDraft | undefined {
    const record = this.drafts.get(id);
    if (record === undefined) {
      return undefined;
    }
    if (this.isExpired(record)) {
      this.drafts.delete(id);
      return undefined;
    }
    return record;
  }

  update(id: string, patch: DraftPatch): StoredDraft | undefined {
    const record = this.get(id);
    if (record === undefined) {
      return undefined;
    }

    if (patch.draft !== undefined) {
      record.draft = patch.draft;
    }
    if (patch.createdBudgetLineId !== undefined) {
      record.createdBudgetLineId = patch.createdBudgetLineId;
    }
    if (patch.writtenSpendingRowId !== undefined) {
      record.writtenSpendingRowId = patch.writtenSpendingRowId;
    }

    return record;
  }

  delete(id: string): boolean {
    return this.drafts.delete(id);
  }

  get size(): number {
    this.purgeExpired();
    return this.drafts.size;
  }

  private isExpired(record: StoredDraft): boolean {
    return this.now() - record.createdAt >= this.ttlMs;
  }

  private purgeExpired(): void {
    for (const [id, record] of this.drafts) {
      if (this.isExpired(record)) {
        this.drafts.delete(id);
      }
    }
  }
}
