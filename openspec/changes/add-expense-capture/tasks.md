# Tasks

## 1. Repository hygiene and project scaffolding

- [ ] 1.1 Write `.gitignore` before anything that creates ignorable files — `node_modules/`, `.env*` (excepting `.env.example`), `.next/`, build output, coverage, `.DS_Store`; verify `git status` reports a clean tree immediately after a dependency install
- [ ] 1.2 Add `.env.example` listing every variable with a description and no real values; verify it names exactly the variables the config validation requires, so the two cannot drift
- [ ] 1.3 Add a pre-commit guard that refuses a commit containing a `.env` file or an obvious credential pattern; verify it blocks a staged file holding a dummy Notion or DeepSeek key and allows an ordinary commit
- [ ] 1.4 Pin the Node version (`.nvmrc` and `engines`) and add `.editorconfig` plus a formatter config; verify the pinned version matches what the deployment host runs and that a format check passes on a clean tree
- [ ] 1.5 Add a README covering what the app is, the variables it needs, and how to run it locally; verify someone can follow it from a fresh clone without reading the planning artifacts
- [ ] 1.6 Initialise the Next.js (App Router, TypeScript) project with a Node runtime target; verify `npm run dev` serves a page, `npm run build` succeeds, and the scaffolder has not replaced or narrowed the `.gitignore` from 1.1
- [ ] 1.7 Add a test runner and lint/typecheck scripts, and verify `npm test`, `npm run lint` and `npm run typecheck` all run clean on the empty project
- [ ] 1.8 Define the budget config schema (both data source IDs, property names, category list, currency options, default currency, timezone, model ID) with parse-time validation; verify unit tests cover a valid config, a config missing a required value, and a config with an unknown category
- [ ] 1.9 Load and validate config at startup so the app refuses to start on incomplete config with a message naming the missing value; verify by starting with a deliberately incomplete env and asserting the error names the field (`notion-integration` — "Budget binding is configuration")

## 2. Notion integration

- [ ] 2.1 Add the Notion client pinned to `Notion-Version: 2025-09-03` or later, and verify against the live API that a `data_source_id`-scoped query of the Budget data source returns rows (a `database_id`-scoped call is ambiguous for this database — see design.md, Context)
- [ ] 2.2 Implement reading Budget line items as `{id, name, category}`; verify against the live Budget data source that all ~45 lines are returned with their categories populated
- [ ] 2.3 Implement creating a Spending row (title, price, currency, date, Budget relation), never writing the read-only `AUS`/`EUR` formula properties; verify against a **scratch duplicate** of the Spending database that a row is created with every field set and the relation resolving
- [ ] 2.4 Implement creating a Budget line item (`Item`, `Category`); verify against the scratch duplicate that the created row carries the exact category option name
- [ ] 2.5 Map Notion API failures (unreachable, unauthorised, rejected write, deleted relation target) onto distinct application errors; verify unit tests assert each maps to its own error rather than a generic failure (`notion-integration` — "Budget data source unreachable", "Write fails")
- [ ] 2.6 Verify no pre-existing row is ever modified or deleted: exercise the write paths against the scratch duplicate and assert row count and contents of pre-existing rows are unchanged (`notion-integration` — "Existing data is untouched")

## 3. Extraction and matching

- [ ] 3.1 Add the DeepSeek client against the OpenAI-compatible endpoint with `deepseek-flash` from config; verify a text-only round trip returns a parseable response
- [ ] 3.2 Define the draft-expense JSON schema (description, amount, currency, date, per-field `assumed` flags, confidence, matched line ID or proposed new line) and verify unit tests reject responses that violate it (`expense-capture` — "Extraction confidence is reported")
- [ ] 3.3 Build the cacheable system prefix carrying instructions, the category list, the Budget line list and the current local date in the configured timezone; verify a snapshot test that the prefix is byte-identical across two calls with an unchanged budget
- [ ] 3.4 Implement free-text extraction; verify tests cover "coffee 8 bucks", a relative date ("yesterday") resolving in the trip timezone, an explicit currency ("200 euro" → `EURO`), an unsupported currency falling back to the default, and text with no amount producing an error (`expense-capture` — "Free-text extraction", "Currency resolution")
- [ ] 3.5 Implement receipt-image extraction from a base64 data URL, rejecting unsupported formats before any model call; verify with real receipt fixtures that the **total** is extracted rather than a subtotal or a line item, and that a non-receipt image errors rather than inventing a draft (`expense-capture` — "Receipt photo extraction")
- [ ] 3.6 Implement defaulting of an unreadable date to today in the configured timezone, marked assumed; verify a fixture receipt with no date produces today's local date flagged as an assumption
- [ ] 3.7 Implement Budget line matching within the same call, returning the chosen line, a confidence signal, a short reason, and the alternatives considered; verify "coffee" matches "Coffee's and snacks" and "Dinner in Sydney" matches "Food Sydney" over "Melbourne Food" (`budget-matching` — "Match a draft expense to an existing budget line")
- [ ] 3.8 Implement the new-line proposal path when nothing fits, constraining the proposed category to the configured list; verify an unmatched spend yields a proposal with a valid category and that an empty budget goes straight to proposing (`budget-matching` — "Propose a new budget line when nothing fits")
- [ ] 3.9 Treat a schema-invalid or unparseable model response as an extraction failure rather than patching it; verify a test feeding a malformed response asserts a clean failure and no draft

## 4. Draft state and the confirmation gate

- [ ] 4.1 Implement the in-memory draft store keyed by client-generated draft ID with a TTL, holding the draft plus `createdBudgetLineId` and `writtenSpendingRowId`; verify unit tests for storage, retrieval and expiry
- [ ] 4.2 Implement the capture endpoints (image and text) returning a draft for review and writing nothing; verify a test asserts no Notion write call occurs during capture (`expense-review` — "Nothing is written without explicit confirmation")
- [ ] 4.3 Implement draft editing of description, amount, currency, date and Budget line without re-running extraction; verify a test that editing one field leaves the others untouched and triggers no model call (`expense-review` — "Every field is editable before confirmation", "Edits do not re-trigger extraction")
- [ ] 4.4 Implement confirm: create the accepted Budget line first where applicable, then the Spending row related to it, committing the user's edited values; verify against the scratch duplicate that both rows appear correctly related (`notion-integration` — "Create an accepted budget line before relating to it")
- [ ] 4.5 Implement discard, clearing the draft with nothing written; verify a test asserts no write call and the draft is gone
- [ ] 4.6 Implement idempotent retry: a confirm on a draft already holding a `writtenSpendingRowId` returns that row without writing again, and a retry after a partial failure reuses `createdBudgetLineId`; verify tests for both, asserting exactly one Spending row and one Budget line result (`expense-review` — "Retry after failure", `notion-integration` — "Expense write fails after the line was created")
- [ ] 4.7 Implement failure reporting that preserves the draft with its edits on a failed write; verify a test that after an injected Notion failure the draft is retrievable with the user's edits intact (`expense-review` — "Failed write")
- [ ] 4.8 Verify no code path writes without confirmation: grep/assert that Notion write functions are reachable only from the confirm handler, and add a test that the capture endpoints cannot produce a write under any input

## 5. Access control and cost limits

- [ ] 5.1 Put the deployment behind Cloudflare Access restricted to the two owners' identities, with the session duration set to the length of the trip; verify an unauthenticated request is challenged, a non-listed identity is refused, and both owners can be signed in at the same time without either displacing the other
- [ ] 5.2 Verify the `CF-Authorization` JWT server-side on every request — signature, audience and expiry — against the Access application's public keys; verify tests for a valid token, an expired token, a wrong-audience token, and a request carrying only the identity header with no valid JWT, which MUST be refused (`notion-integration` — "Access is restricted to authorised identities"; design.md — "The origin must not be reachable directly")
- [ ] 5.3 Lock the origin so it is reachable only through Cloudflare, preferring a Cloudflare Tunnel so the host exposes no inbound public port; verify that a direct request to the origin address fails from outside Cloudflare
- [ ] 5.4 Gate the local development auth bypass behind an explicit flag that refuses to start under production configuration; verify startup fails when the bypass is enabled in a production config
- [ ] 5.5 Rate-limit the capture endpoints per identity with a daily ceiling well above two people logging a trip; verify the ceiling triggers, returns a clear message rather than a generic error, and is recorded somewhere visible (design.md — "Spending limits on the model endpoints")
- [ ] 5.6 Verify credentials never reach the client: assert no Notion or DeepSeek key appears in any built client bundle or API response body (`notion-integration` — "Credentials stay server-side")

## 6. PWA client

- [ ] 6.1 Build the mobile-first capture screen with a free-text box and a camera control implemented as `<input type="file" accept="image/*" capture="environment">` — identical behaviour on iOS Safari and Android Chrome, and no `getUserMedia` permission handling; verify on both an iPhone and an Android device that it opens the rear camera directly and that both inputs are reachable one-handed without scrolling
- [ ] 6.2 Implement client-side image downscaling to ~1300px on the long side, preserving the long axis of tall receipts, re-encoded as JPEG; verify a tall receipt fixture keeps its aspect ratio and the upload payload drops below ~300KB
- [ ] 6.3 Build the review screen showing description, amount, currency, date and Budget line, with every field editable; verify each field can be changed and the edited values are what get confirmed (`expense-review` — "Every field is editable before confirmation")
- [ ] 6.4 Surface uncertainty in the review screen: mark assumed fields, draw attention to low-confidence amounts, and state explicitly when confirming will create a new Budget line with its name and category; verify each case renders distinctly from a plain extracted field (`expense-review` — "Uncertainty is visible at review")
- [ ] 6.5 Build Budget line override: search all current lines by name and filter by category; verify every line is reachable and selecting one replaces the match (`budget-matching` — "Budget lines are readable and selectable in full", "User overrides the match")
- [ ] 6.6 Implement confirm and discard actions with success feedback naming the amount and the Budget line it was recorded against, and failure feedback that keeps the draft for retry; verify both outcomes render correctly (`expense-review` — "Confirmation reports its outcome")
- [ ] 6.7 Add the web app manifest, `apple-touch-icon`, icon set and service worker so the app installs to the home screen and loads its shell without a network round trip; verify a mobile browser audit reports it installable
- [ ] 6.8 Implement the Android install prompt via `beforeinstallprompt`, and an iOS-only hint shown when the app runs in iOS Safari outside standalone mode, giving the Share → Add to Home Screen steps and saying to install **before** logging in; verify the hint appears on iOS Safari, disappears once standalone, and never appears on Android (design.md — "The iPhone never gets an install prompt")
- [ ] 6.9 Verify the install-then-login ordering on a real iPhone: install from the hint, then complete the Cloudflare Access sign-in inside the installed app and confirm it works there; separately confirm that signing in via Safari first does not carry the Access session into the installed app — the reason the hint says install first (design.md — "Installing after logging in loses the session")
- [ ] 6.10 Handle a lost connection during capture or confirm with a clear message and a preserved draft; verify by exercising the flow with the network offline that nothing is lost and nothing is written

## 7. Deployment and end-to-end verification

- [ ] 7.1 Create the Notion internal integration and share **both** the `💸 Budget` and Spending databases with it, and **only** those two — not the parent `AUSTRALIA` page, since sharing a page cascades to its children; verify the integration can read Budget lines and write to the scratch duplicate, and verify it *cannot* read a sibling page elsewhere under `AUSTRALIA`
- [ ] 7.2 Run the full flow against the scratch duplicate databases: photo → review → confirm, and text → review → confirm, including one new-line proposal accepted; verify each produces exactly one correctly related Spending row
- [ ] 7.3 Deploy as a single always-on instance with no autoscaling (in-memory draft state assumes one instance) and verify the deployed URL loads over mobile data
- [ ] 7.4 Point config at the live trip databases, install the PWA on the Android device, and verify one real spend end to end from an Australian mobile connection
- [ ] 7.5 Verify the iPhone independently: have the partner install the app from the in-app hint **without being talked through it**, log in, and log one real spend — if she cannot install it unaided, the hint has failed and needs reworking before departure
- [ ] 7.6 Verify both devices stay logged in: leave both sessions idle for seven days, then confirm neither has been signed out (design.md — "Safari evicts the session after a week of disuse")
- [ ] 7.7 Verify the access boundary on the real deployment, not just in tests: confirm the origin cannot be reached directly, that a signed-out browser is challenged, and that an identity outside the Access policy is refused (`notion-integration` — "Access is restricted to authorised identities"; design.md — "Identity header trusted without the JWT")
- [ ] 7.8 Verify the live Budget and Spending rows that pre-date the app are unchanged after the first real write
