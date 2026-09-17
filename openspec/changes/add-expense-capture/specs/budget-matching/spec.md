# Spec Delta

## Purpose

Connects a draft expense to the budget line it draws down, choosing the best fit among the budget's existing lines and proposing a new line when nothing fits, so that spending stays reconciled against the plan.

## ADDED Requirements

### Requirement: Match a draft expense to an existing budget line

The system SHALL compare each draft expense against the budget's current line items and return the best-fitting line together with a confidence signal and a short human-readable reason for the choice.

Matching SHALL consider the line's name and its category, and SHALL be restricted to lines that exist in the target budget at the time of matching.

#### Scenario: Clear match

- **WHEN** a draft expense described as "Coffee" is matched against a budget containing a line "Coffee's and snacks" in category Food
- **THEN** that line is returned as the match with high confidence

#### Scenario: Match is one of several plausible lines

- **WHEN** a draft expense described as "Dinner in Sydney" is matched against a budget containing both "Food Sydney" and "Melbourne Food"
- **THEN** "Food Sydney" is returned as the match
- **AND** the alternatives considered remain available for the user to choose from instead

#### Scenario: Budget has no line items

- **WHEN** the target budget contains no line items
- **THEN** no match is returned
- **AND** the system proceeds directly to proposing a new budget line

### Requirement: Propose a new budget line when nothing fits

Where no existing line is a good fit, the system SHALL propose a new budget line rather than returning a poor match. A proposal SHALL include a name and a category drawn from the budget's configured category list.

A proposed budget line SHALL NOT be created in the budget until the user explicitly accepts it.

#### Scenario: No existing line fits

- **WHEN** a draft expense described as "Scuba diving course" is matched against a budget with no diving-related line
- **THEN** the system returns a proposal for a new line named for the activity, in category Activity
- **AND** no line is created at this point

#### Scenario: Proposed category must be a configured one

- **WHEN** the system proposes a new budget line
- **THEN** its category is one of the categories configured for the budget

#### Scenario: User rejects the proposal

- **WHEN** the user rejects a proposed new line and selects an existing line instead
- **THEN** no new budget line is created
- **AND** the expense is associated with the line the user selected

### Requirement: Every match is presented for confirmation

The system SHALL NOT associate an expense with a budget line without the user confirming that association, regardless of match confidence.

#### Scenario: High-confidence match still requires confirmation

- **WHEN** a draft expense matches an existing line with high confidence
- **THEN** the match is presented to the user for confirmation before anything is written

#### Scenario: User overrides the match

- **WHEN** the user selects a different budget line than the one matched
- **THEN** the expense is associated with the user's selection

### Requirement: Budget lines are readable and selectable in full

The system SHALL make the budget's complete set of line items available for the user to search and select from, so that a user can always override a match or proposal manually.

#### Scenario: Manual selection

- **WHEN** a user chooses to pick a budget line themselves
- **THEN** all current line items in the budget are available to search by name and filter by category

#### Scenario: Budget lines changed in the source

- **WHEN** budget line items have been added or renamed in the source budget since they were last read
- **THEN** a subsequent match uses the updated set of line items
