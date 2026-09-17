# Spec Delta

## Purpose

Turns a receipt photograph or a free-text sentence into a structured draft expense — description, amount, currency, and date — so that logging a spend takes one action instead of filling a form.

## ADDED Requirements

### Requirement: Receipt photo extraction

The system SHALL accept a photograph of a receipt and extract a draft expense containing a description, a numeric amount, a currency, and a date.

The extracted amount MUST be the total actually paid, not a subtotal, a line item, or a pre-discount figure. Where a receipt shows both a subtotal and a total, the total SHALL be used.

Supported image formats SHALL be JPEG, PNG, GIF, and WebP.

#### Scenario: Legible receipt

- **WHEN** a user submits a photo of a receipt showing "WOOLWORTHS", a total of "$43.20", and a date of "17/09/2026"
- **THEN** the system produces a draft expense with description "Woolworths", amount 43.20, currency AUD, and date 2026-09-17

#### Scenario: Receipt with subtotal, tax, and total

- **WHEN** a receipt shows a subtotal of 39.27, GST of 3.93, and a total of 43.20
- **THEN** the draft expense amount is 43.20

#### Scenario: Receipt with no readable date

- **WHEN** a receipt's date is illegible or absent
- **THEN** the draft expense date defaults to the current date in the configured local timezone
- **AND** the date field is flagged as assumed rather than extracted

#### Scenario: Image is not a receipt

- **WHEN** a user submits an image in which no total amount can be identified
- **THEN** the system does not produce a draft expense
- **AND** returns an error stating that no amount could be read, inviting the user to retry or enter the spend as text

#### Scenario: Unsupported image format

- **WHEN** a user submits a file that is not one of the supported image formats
- **THEN** the system rejects it before any model call and reports which formats are accepted

### Requirement: Free-text extraction

The system SHALL accept a free-text description of a spend and extract a draft expense of the same shape as a photo-derived one.

Relative dates expressed in the text SHALL be resolved against the current date in the configured local timezone.

#### Scenario: Amount and description only

- **WHEN** a user enters "coffee 8 bucks"
- **THEN** the system produces a draft expense with description "Coffee", amount 8.00, currency the configured default, and date today

#### Scenario: Relative date

- **WHEN** a user enters "43.20 groceries at woolies yesterday" on 2026-09-17
- **THEN** the draft expense has date 2026-09-16

#### Scenario: Explicit currency

- **WHEN** a user enters "camper deposit 200 euro"
- **THEN** the draft expense currency is EURO regardless of the configured default

#### Scenario: No amount in the text

- **WHEN** a user enters text containing no recognisable amount, such as "lunch somewhere nice"
- **THEN** the system does not produce a draft expense
- **AND** returns an error asking the user to include an amount

### Requirement: Currency resolution

Every draft expense SHALL carry a currency that is one of the currencies configured for the target budget.

Where the input states or symbolises a currency, that currency SHALL be used. Where it does not, the configured default currency SHALL be used and the field flagged as assumed.

#### Scenario: Currency symbol on a receipt

- **WHEN** a receipt shows "€90.88"
- **THEN** the draft expense currency is EURO

#### Scenario: Currency absent from input

- **WHEN** the input states an amount with no currency indication and the configured default is AUD
- **THEN** the draft expense currency is AUD
- **AND** the currency field is flagged as assumed

#### Scenario: Currency outside the configured set

- **WHEN** the input indicates a currency that is not configured for the budget, such as USD
- **THEN** the draft expense currency falls back to the configured default
- **AND** the system records that the stated currency was not supported, so the review step can surface it

### Requirement: Extraction confidence is reported

Each draft expense SHALL carry a confidence signal, and each field derived by assumption rather than from the input SHALL be individually marked as assumed.

#### Scenario: Low-confidence extraction

- **WHEN** the model's extraction of an amount is low confidence, for example from a blurred receipt
- **THEN** the draft expense is still produced and marked low confidence, so the review step can draw attention to the amount

#### Scenario: Assumed fields are distinguishable

- **WHEN** a draft expense has a defaulted date and an extracted amount
- **THEN** the date is marked assumed and the amount is not
