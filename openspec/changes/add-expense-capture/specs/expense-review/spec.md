# Spec Delta

## Purpose

Guarantees that a human sees and approves every expense before it reaches the budget, giving the user a chance to correct model misreadings that would otherwise silently corrupt their spending totals.

## ADDED Requirements

### Requirement: Nothing is written without explicit confirmation

The system SHALL present every draft expense for review and SHALL write nothing to the budget until the user explicitly confirms it. This applies equally to photo-derived and text-derived drafts.

There SHALL be no configuration, mode, or input path that bypasses this confirmation.

#### Scenario: Draft awaits confirmation

- **WHEN** a draft expense is produced from any input
- **THEN** it is displayed for review
- **AND** no data is written to the budget

#### Scenario: User confirms

- **WHEN** a user confirms a reviewed draft expense
- **THEN** the expense is written to the budget

#### Scenario: User discards

- **WHEN** a user discards a draft expense
- **THEN** nothing is written to the budget
- **AND** the draft is cleared

#### Scenario: User abandons the session

- **WHEN** a user closes the application with a draft expense unconfirmed
- **THEN** nothing is written to the budget

### Requirement: Every field is editable before confirmation

The review step SHALL allow the user to change the description, amount, currency, date, and associated budget line of a draft expense before confirming it.

Confirmed values SHALL be the user's edited values, not the originally extracted ones.

#### Scenario: Correcting a misread amount

- **WHEN** a user changes a draft expense's amount from 432.00 to 43.20 and confirms
- **THEN** the expense is written with amount 43.20

#### Scenario: Correcting the budget line

- **WHEN** a user changes the associated budget line before confirming
- **THEN** the expense is written against the line the user chose

#### Scenario: Edits do not re-trigger extraction

- **WHEN** a user edits a field of a draft expense
- **THEN** no new extraction is performed and the user's other fields are left as they are

### Requirement: Uncertainty is visible at review

The review step SHALL visually distinguish fields that were assumed rather than extracted, and SHALL draw attention to low-confidence extractions and to proposed new budget lines.

#### Scenario: Assumed date is flagged

- **WHEN** a draft expense's date was defaulted because the receipt had none
- **THEN** the review step marks the date as an assumption

#### Scenario: Low-confidence amount is flagged

- **WHEN** an amount was extracted with low confidence
- **THEN** the review step draws attention to the amount

#### Scenario: New budget line is clearly a creation

- **WHEN** the associated budget line is a proposal rather than an existing line
- **THEN** the review step states that confirming will create a new budget line, showing its name and category

### Requirement: Confirmation reports its outcome

After a user confirms, the system SHALL report whether the write succeeded, and on success SHALL identify what was written.

#### Scenario: Successful write

- **WHEN** a confirmed expense is written successfully
- **THEN** the user is shown that it was recorded, including the amount and the budget line it was recorded against

#### Scenario: Failed write

- **WHEN** writing a confirmed expense fails
- **THEN** the user is told it was not recorded
- **AND** the draft expense is preserved with its edits so the user can retry without re-entering it

#### Scenario: Retry after failure

- **WHEN** a user retries a previously failed confirmation and it succeeds
- **THEN** exactly one expense is recorded
