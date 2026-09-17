# Spec Delta

## Purpose

Binds the application to the user's Notion budget so that budget lines can be read and confirmed spends written back, without hard-coding any particular budget's identifiers or categories into the application.

## ADDED Requirements

### Requirement: Budget binding is configuration

The identifiers of the spending and budget data sources, the category list, the currency set, the default currency, and the local timezone SHALL be supplied by configuration rather than embedded in code.

The system SHALL validate this configuration at startup and SHALL refuse to start with a clear error when it is absent or incomplete.

#### Scenario: Valid configuration

- **WHEN** the application starts with a complete budget configuration
- **THEN** it starts and serves requests

#### Scenario: Missing configuration

- **WHEN** a required configuration value is absent
- **THEN** the application does not start
- **AND** reports which value is missing

#### Scenario: Retargeting to a different budget

- **WHEN** the configuration is changed to point at a different budget's data sources and categories
- **THEN** the application operates against that budget with no code change

### Requirement: Read budget line items

The system SHALL read the full set of line items from the configured budget data source, exposing each line's identifier, name, and category.

#### Scenario: Reading lines

- **WHEN** the system reads the configured budget data source
- **THEN** it returns every line item with its identifier, name, and category

#### Scenario: Budget data source unreachable

- **WHEN** the budget data source cannot be read
- **THEN** the system reports that budget lines are unavailable
- **AND** does not present a match or a proposal derived from stale or empty data as though it were current

### Requirement: Write a confirmed expense

On confirmation, the system SHALL create one row in the configured spending data source carrying the expense's description as its title, its amount, its currency, and its date, related to the confirmed budget line.

The system SHALL NOT modify or delete any existing row.

#### Scenario: Expense is written

- **WHEN** a confirmed expense of 43.20 AUD dated 2026-09-17, described "Woolworths", against budget line "Food Roadtrip (week)" is written
- **THEN** a new spending row exists with those values and a relation to that budget line

#### Scenario: Only the currencies the budget defines

- **WHEN** an expense is written
- **THEN** its currency is one of the currencies configured for the budget

#### Scenario: Existing data is untouched

- **WHEN** any expense is written
- **THEN** no pre-existing spending row or budget line is altered or removed

#### Scenario: Write fails

- **WHEN** the spending data source rejects the write or is unreachable
- **THEN** the system reports the failure
- **AND** no partial spending row remains

### Requirement: Create an accepted budget line before relating to it

Where the user accepted a proposed new budget line, the system SHALL create that line in the configured budget data source and relate the spending row to it, so that a confirmation never yields an unrelated spending row.

#### Scenario: New line then expense

- **WHEN** a user confirms an expense against an accepted proposed budget line
- **THEN** the budget line is created with its proposed name and category
- **AND** the spending row is created related to that new line

#### Scenario: Budget line creation fails

- **WHEN** creating the proposed budget line fails
- **THEN** no spending row is created
- **AND** the user is told the expense was not recorded

#### Scenario: Expense write fails after the line was created

- **WHEN** the budget line is created but the spending row write then fails
- **THEN** the user is told the expense was not recorded and that the budget line was created
- **AND** a retry relates the expense to that already-created line rather than creating a duplicate line

### Requirement: Credentials stay server-side

API credentials for Notion and for the extraction model SHALL be held server-side and SHALL NOT be transmitted to or stored in the browser.

#### Scenario: Credentials absent from client

- **WHEN** the application is loaded in a browser
- **THEN** no Notion or model API credential is present in any client-delivered asset or client-visible response

#### Scenario: Model and budget calls are server-side

- **WHEN** an extraction or a budget read or write occurs
- **THEN** the request to the external service originates from the server, not from the browser

### Requirement: Access is restricted to authorised identities

All capture, budget-read, edit and confirm operations SHALL be reachable only by an authorised identity. A request that does not carry proof of an authorised identity, verified by the system itself, SHALL be refused.

Verification SHALL be performed by the system on every request. A claim of identity that the system has not itself verified SHALL NOT be treated as proof.

#### Scenario: Unauthenticated request

- **WHEN** a request arrives without verified proof of an authorised identity
- **THEN** it is refused
- **AND** no model call, budget read, or budget write occurs

#### Scenario: Unverified identity claim

- **WHEN** a request carries a claimed identity that the system cannot itself verify
- **THEN** it is refused rather than trusted

#### Scenario: Identity outside the authorised set

- **WHEN** a request carries a verified identity that is not authorised for this budget
- **THEN** it is refused

#### Scenario: Authorised identities are concurrent

- **WHEN** two authorised identities are signed in at the same time
- **THEN** both can capture and confirm independently, and neither displaces the other
