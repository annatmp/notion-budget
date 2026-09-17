# Proposal

## Why

Tracking spending during the Australia trip currently means opening Notion on a phone and hand-filling a Spending row — name, price, currency, date, and a relation to the right Budget line. That is enough friction that spends go unlogged in the moment, and the trip's budget-vs-actual rollups drift out of date exactly when they are most useful. Capturing a spend should take one photo or one short sentence.

## What Changes

- A new mobile-first PWA for logging spends, usable one-handed on a phone with a patchy connection. Two people share the one trip budget and log against it from two devices — one iPhone, one Android.
- **Receipt capture**: photograph a receipt; a vision LLM (DeepSeek `deepseek-flash`) extracts merchant, total, currency, and date into a draft expense.
- **Free-text capture**: type `coffee 8 bucks` or `43.20 groceries at woolies yesterday`; the same model parses it into the same draft shape.
- **Budget line matching**: the draft is matched against the trip's existing Budget line items. When nothing fits well, the app proposes a *new* Budget line (with a Category) rather than forcing a bad match.
- **Mandatory confirmation**: every draft — photo or text — is shown for review and edit, and nothing is written to Notion until it is explicitly confirmed. There is no silent-write path.
- **Notion write**: on confirmation, create a `Spending` row (`Name`, `Price`, `Currency`, `Date paid/to be paid`) related to the chosen Budget line, creating the Budget line first if the user accepted a proposed one.
- Notion database IDs, the category list, and the default currency come from configuration, not from code.

## Capabilities

### New Capabilities
- `expense-capture`: Turning a receipt photo or a free-text sentence into a structured draft expense (description, amount, currency, date), including how low-confidence and unreadable inputs are surfaced.
- `budget-matching`: Selecting the best-fitting Budget line for a draft expense from the trip's existing lines, and proposing a new Budget line with a Category when no existing line fits.
- `expense-review`: The confirm-before-write gate — presenting a draft for review, allowing every field to be edited, and committing or discarding it.
- `notion-integration`: Reading Budget line items from Notion and writing Spending rows and new Budget lines back, including schema/config binding and failure handling.

### Modified Capabilities
<!-- None. This project has no existing specs. -->

## Impact

- **New codebase.** The project is currently empty apart from OpenSpec scaffolding; this change establishes its structure.
- **External dependencies**: Notion API (internal integration token, scoped to the `💸 Budget` and Spending databases only); DeepSeek API (`deepseek-flash`, OpenAI-compatible Chat Completions); Cloudflare Access, which provides authentication so the app implements none.
- **Notion data written**: rows added to the `Spending` data source, and — only on explicit acceptance — rows added to the `Budget` data source. No existing rows are modified or deleted.
- **Hosting**: requires a small always-on host reachable from an Australian mobile network, serving the PWA and holding the API credentials server-side, reached through a Cloudflare Tunnel rather than a public inbound port.
- **Cost**: at DeepSeek's `deepseek-flash` rates (≤1024 tokens per image; $0.30/1M input, $1.20/1M output at peak), a receipt costs roughly $0.001 to parse — a full trip of daily logging stays under a dollar.
- **Secrets**: Notion and DeepSeek keys must never reach the browser; all model and Notion calls are server-side. Capture endpoints are rate-limited per identity so an authenticated caller cannot run up the model bill.
