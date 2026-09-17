import { randomUUID } from 'node:crypto';

import type { DraftExpense } from '@/extract/draft';
import { type ExtractionContext, extractFromImage, extractFromText } from '@/extract/extract';
import { isIsoDate } from '@/extract/time';
import type { BudgetLine } from '@/notion/budget-lines';
import type { NewSpendingRow, WrittenSpendingRow } from '@/notion/spending';

import { DraftStore, type StoredDraft } from './store';

export class UnknownDraftError extends Error {
  override readonly name = 'UnknownDraftError';

  constructor(id: string) {
    super(`No draft ${id}. It may have expired, or the server may have restarted.`);
  }
}

export class InvalidDraftEditError extends Error {
  override readonly name = 'InvalidDraftEditError';
}

/**
 * A confirm that did not record the expense.
 *
 * `budgetLineCreated` is carried because the two outcomes read differently to
 * the user: "nothing was recorded" versus "the budget line was created but the
 * expense was not" — and in the second case a retry must reuse that line rather
 * than create a second one (`specs/notion-integration`).
 */
export class ConfirmError extends Error {
  override readonly name = 'ConfirmError';

  constructor(
    message: string,
    readonly budgetLineCreated: boolean,
    options: { cause?: unknown } = {},
  ) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
  }
}

export interface DraftServiceDeps {
  store: DraftStore;
  /** Read fresh on every capture and every line change, never cached. */
  readBudgetLines(): Promise<BudgetLine[]>;
  createBudgetLine(input: { name: string; category: string }): Promise<BudgetLine>;
  createSpendingRow(input: NewSpendingRow): Promise<WrittenSpendingRow>;
  /** Everything extraction needs except the budget lines, which are read per capture. */
  extraction: Omit<ExtractionContext, 'budgetLines'>;
  /** Overridable so tests can drive the pipeline without a live model. */
  runTextExtraction?(text: string, context: ExtractionContext): Promise<DraftExpense>;
  runImageExtraction?(
    dataUrl: string,
    context: ExtractionContext,
    caption?: string,
  ): Promise<DraftExpense>;
}

/** The fields the review step allows a user to change. */
export interface DraftEdit {
  description?: string;
  amount?: number;
  currency?: string;
  date?: string;
  match?: DraftExpense['match'];
}

export interface ConfirmResult {
  spendingRowId: string;
  budgetLineId: string;
  budgetLineName: string;
  amount: number;
  currency: string;
  /** Matches the amount and line the user is shown on success (task 6.6). */
  createdBudgetLine: boolean;
  /**
   * True when this call wrote the row, false when it returned a row written by
   * an earlier call. The distinction is what makes a retry safe.
   */
  written: boolean;
}

/**
 * The confirm-before-write gate.
 *
 * Every capture produces a draft and writes nothing. Only `confirm` reaches the
 * Notion writers, which is the invariant the whole design rests on
 * (`specs/expense-review` — "Nothing is written without explicit confirmation").
 */
export class DraftService {
  constructor(private readonly deps: DraftServiceDeps) {}

  async captureFromText(input: { text: string; draftId?: string }): Promise<StoredDraft> {
    const context = await this.extractionContext();
    const extract = this.deps.runTextExtraction ?? extractFromText;

    const draft = await extract(input.text, context);

    return this.deps.store.put(input.draftId ?? randomUUID(), draft);
  }

  async captureFromImage(input: {
    dataUrl: string;
    caption?: string;
    draftId?: string;
  }): Promise<StoredDraft> {
    const context = await this.extractionContext();
    const extract = this.deps.runImageExtraction ?? extractFromImage;

    const draft =
      input.caption === undefined
        ? await extract(input.dataUrl, context)
        : await extract(input.dataUrl, context, input.caption);

    return this.deps.store.put(input.draftId ?? randomUUID(), draft);
  }

  get(id: string): StoredDraft {
    const record = this.deps.store.get(id);
    if (record === undefined) {
      throw new UnknownDraftError(id);
    }
    return record;
  }

  /**
   * Applies the user's edits.
   *
   * Deliberately does not re-run extraction: the user has already seen what the
   * model produced and is correcting it, so calling the model again would
   * discard their correction and cost another round trip
   * (`specs/expense-review` — "Edits do not re-trigger extraction").
   */
  async edit(id: string, changes: DraftEdit): Promise<StoredDraft> {
    const record = this.get(id);
    const next: DraftExpense = { ...record.draft };

    if (changes.description !== undefined) {
      const description = changes.description.trim();
      if (description === '') {
        throw new InvalidDraftEditError('A description is required.');
      }
      next.description = description;
    }

    if (changes.amount !== undefined) {
      if (!Number.isFinite(changes.amount) || changes.amount <= 0) {
        throw new InvalidDraftEditError('The amount must be greater than zero.');
      }
      next.amount = changes.amount;
    }

    if (changes.currency !== undefined) {
      if (!this.deps.extraction.currencies.includes(changes.currency)) {
        throw new InvalidDraftEditError(
          `"${changes.currency}" is not one of the budget's currencies.`,
        );
      }
      next.currency = changes.currency;
      next.assumed = { ...next.assumed, currency: false };
      next.unsupportedCurrency = null;
    }

    if (changes.date !== undefined) {
      if (!isIsoDate(changes.date)) {
        throw new InvalidDraftEditError('The date must be a real date in YYYY-MM-DD form.');
      }
      next.date = changes.date;
      next.assumed = { ...next.assumed, date: false };
    }

    if (changes.match !== undefined) {
      next.match = await this.validateMatch(changes.match);
    }

    return this.deps.store.update(id, { draft: next }) ?? this.get(id);
  }

  /** Clears the draft. Nothing was written, so there is nothing to undo. */
  discard(id: string): boolean {
    return this.deps.store.delete(id);
  }

  /**
   * Writes the confirmed expense.
   *
   * Order matters: where the user accepted a proposed line, the line is created
   * first and the spending row related to it. The reverse order would leave an
   * unrelated spending row — invisible in the rollups and easy to miss — whereas
   * an orphan budget line is visible, harmless, and reused on retry
   * (`design.md` — "Write order: Budget line first, then Spending row").
   */
  async confirm(id: string): Promise<ConfirmResult> {
    const record = this.get(id);

    // Already written: return that row rather than writing a second one.
    if (record.writtenSpendingRowId !== null) {
      return this.resultFor(record, record.writtenSpendingRowId, false);
    }

    const { draft } = record;
    let budgetLineId: string;
    let createdBudgetLine = false;

    if (draft.match.kind === 'proposed') {
      if (record.createdBudgetLineId !== null) {
        // A previous attempt created the line and then failed on the row. Reuse
        // it rather than creating a duplicate.
        budgetLineId = record.createdBudgetLineId;
      } else {
        try {
          const line = await this.deps.createBudgetLine({
            name: draft.match.name,
            category: draft.match.category,
          });
          budgetLineId = line.id;
          createdBudgetLine = true;
          // Recorded before the row write, so a failure after this point can
          // still find it.
          this.deps.store.update(id, { createdBudgetLineId: line.id });
        } catch (cause) {
          throw new ConfirmError(
            'Not recorded — the new budget line could not be created, so no expense was written.',
            false,
            { cause },
          );
        }
      }
    } else {
      budgetLineId = draft.match.lineId;
    }

    try {
      const row = await this.deps.createSpendingRow({
        description: draft.description,
        amount: draft.amount,
        currency: draft.currency,
        date: draft.date,
        budgetLineId,
      });

      this.deps.store.update(id, { writtenSpendingRowId: row.id });

      return {
        spendingRowId: row.id,
        budgetLineId,
        budgetLineName: this.lineNameFor(draft),
        amount: draft.amount,
        currency: draft.currency,
        createdBudgetLine,
        written: true,
      };
    } catch (cause) {
      // The draft stays exactly as the user left it, so the retry needs no
      // re-entry (`specs/expense-review` — "Failed write").
      throw new ConfirmError(
        createdBudgetLine
          ? 'Not recorded — the budget line was created, but the expense was not. Retrying will use that line.'
          : 'Not recorded — the expense was not written.',
        createdBudgetLine,
        { cause },
      );
    }
  }

  private async extractionContext(): Promise<ExtractionContext> {
    return { ...this.deps.extraction, budgetLines: await this.deps.readBudgetLines() };
  }

  private async validateMatch(match: DraftExpense['match']): Promise<DraftExpense['match']> {
    if (match.kind === 'proposed') {
      if (!this.deps.extraction.categories.includes(match.category)) {
        throw new InvalidDraftEditError(
          `"${match.category}" is not one of the budget's categories.`,
        );
      }
      return match;
    }

    const lines = await this.deps.readBudgetLines();
    const line = lines.find((candidate) => candidate.id === match.lineId);
    if (line === undefined) {
      throw new InvalidDraftEditError('That budget line is no longer in the budget.');
    }

    return { ...match, lineId: line.id, lineName: line.name };
  }

  private lineNameFor(draft: DraftExpense): string {
    return draft.match.kind === 'existing' ? draft.match.lineName : draft.match.name;
  }

  private resultFor(record: StoredDraft, spendingRowId: string, written: boolean): ConfirmResult {
    return {
      spendingRowId,
      budgetLineId: record.createdBudgetLineId ?? this.lineIdFor(record.draft),
      budgetLineName: this.lineNameFor(record.draft),
      amount: record.draft.amount,
      currency: record.draft.currency,
      createdBudgetLine: record.createdBudgetLineId !== null,
      written,
    };
  }

  private lineIdFor(draft: DraftExpense): string {
    return draft.match.kind === 'existing' ? draft.match.lineId : '';
  }
}
