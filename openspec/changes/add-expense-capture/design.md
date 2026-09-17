# Design

## Context

See `proposal.md` — Why. The constraints that actually shape the approach:

**The target budget is already built and in use.** The `💸 Budget` Notion database (`3ca86094-f992-80e7-bc4a-d64562779170`) holds two data sources:

| | Data source ID | Shape |
|---|---|---|
| Budget | `3ca86094-f992-8055-943e-000b8fecdada` | `Item` (title), `Category` (select), `Quantity`, `Unit Price`, `Paid Euro`, relations to Spending and Planning, plus formulas |
| Totals | `3ca86094-f992-8014-8f10-000b14436d66` | Unrelated scratch table |

Spending is a **separate** database (`3ca86094f99280bb9bdcee32b05b1693`), data source `3ca86094-f992-809a-9ca6-000bea693d94`: `Name` (title), `Price` (number), `Currency` (select: `EURO` | `AUD`), `Date paid/to be paid` (date), `💸 Budget` (relation → Budget), plus read-only `AUS` / `EUR` formulas.

Three facts follow from this that the implementation cannot ignore:

1. **Budget is a multi-data-source database.** `database_id` alone is ambiguous, and a `database_id`-scoped integration breaks when a database gains a second data source — which this one already has. All calls must be `data_source_id`-scoped, which requires `Notion-Version: 2025-09-03` or later.
2. **Categorisation lives on the Budget line, not the spend.** The Spending table has no Category. A spend is categorised *by which Budget line it relates to* — which is why matching is load-bearing rather than a nicety, and why all 7 existing Spending rows carry a relation.
3. **`AUS` and `EUR` are formulas.** They are computed from `Price` and `Currency` and must never be written.

The budget currently holds ~45 Budget lines across 8 categories (Accomodation, Food, Tours, Activity, Transport, Flights, Misc, Full Trip) and 7 Spending rows. Select option names are literal: `EURO`, not `EUR`; `Accomodation`, not `Accommodation`.

**Operating environment**: two phones — one iPhone, one Android — in Australia, on mobile data of varying quality, one-handed, often immediately after paying. Two people share the single budget and both log spends against it.

## Goals / Non-Goals

**Goals:**
- One interaction from "I paid for this" to a correctly related Spending row.
- Model misreadings are caught by the user, not by the budget totals a week later.
- Retargeting to a future trip's budget is a config edit, not a rewrite.
- Credentials never reach the browser.
- Cheap enough that cost is never a reason to hesitate before logging a spend.

**Non-Goals:**
- **Offline capture.** Extraction requires a server round trip, so a queued offline spend could not be reviewed at capture time — which is the one guarantee this design is built around. On failure the draft is preserved for retry (see `specs/expense-review`); genuine offline queueing is deliberately deferred.
- **Editing or deleting existing rows.** The app only appends. Corrections happen in Notion.
- **Reading the budget back.** No dashboards, totals, or burn-down; Notion already renders those.
- **Accounts and attribution.** Two people share one budget from two devices, but the app keeps no user accounts of its own and records no attribution: the proxy knows which of them is signed in, and the app deliberately does not use that to mark who logged a given spend. The Spending data source has no payer property and none is added. This is multi-device, not multi-tenant: concurrent sessions on both phones are expected and supported.
- **Duplicate detection.** Both of them may photograph the same receipt and log it twice. Accepted deliberately — they both have Notion access and will correct it there, and the alternative is a false-positive warning on every genuine second coffee of the day. Nothing in the app checks for an existing similar Spending row.
- **Schema discovery.** Property names are config, not introspected.
- **Splitting a receipt into line items.** One receipt, one total, one Spending row.

## Decisions

### Single Next.js app on a small always-on Node host

One deployable serving both the PWA and the server routes. Server routes hold the Notion and DeepSeek keys, so the browser only ever talks to our own origin. Deploy target: Fly.io or Railway, single small instance, Node runtime (not edge — see draft state below), reached through a Cloudflare Tunnel rather than a public inbound port.

*Alternatives considered:* a static SPA plus a separate API service — two deploys, CORS, and no gain at this size. Serverless functions — cold starts on mobile data hurt the one interaction that matters, and there is no stable place for draft state.

*This is the most reversible decision here.* Nothing in the specs depends on the framework.

### Extraction and matching in one model call

The ~45 Budget lines compress to roughly 600 tokens (`id | name | category`). Sending them alongside the image or text and asking for the draft *and* its best-matching line in one structured response removes a round trip from the critical path — which matters far more on Australian mobile data than the marginal token cost.

The budget-line list and the instructions go in the **system prefix**, unchanged between calls, so DeepSeek's prefix cache applies: cache-hit input is $0.003/1M against $0.30/1M on a miss. Refresh the prefix only when Budget lines change.

*Alternatives considered:* two calls (extract, then match) — cleaner separation, one more round trip, and the matcher would have to re-read the amount anyway. Local fuzzy or embedding match — avoids a call, but "coffee" → "Coffee's and snacks" is a semantic judgement, and an embedding index is more machinery than 45 rows justify.

### DeepSeek `deepseek-flash` via the OpenAI-compatible endpoint

`deepseek-flash` (V4.1-Flash) is DeepSeek's current model that accepts images; `deepseek-v4-pro` is text-only. Images may be passed as base64 data URLs, public URLs, or Files API IDs — base64 here, since receipts must not be made publicly addressable.

Structured output is requested via JSON schema so the response parses deterministically; a response that fails schema validation is treated as an extraction failure, not silently patched.

Budget: an image is capped at 1024 tokens, plus ~600 tokens of cached prefix and ~150 output tokens — around **$0.001 per receipt at peak rates**, less on a cache hit.

### Client-side image downscaling before upload

DeepSeek resizes every image to roughly 1300×1300 regardless, so uploading a 4MB phone photo wastes only the user's mobile data. Downscale to ~1300px on the long side and re-encode as JPEG in the browser before upload.

*Trade-off:* this is also where receipt legibility is won or lost, so downscaling must preserve the long axis of a tall receipt rather than fitting it into a square.

### Server-held draft state, keyed by a client-generated draft ID

The specs require that a retry after a partial failure yields exactly one Spending row and does not duplicate an already-created Budget line. Notion offers no idempotency key, so the server keeps each draft in memory against its draft ID, recording `createdBudgetLineId` and `writtenSpendingRowId` as they are obtained. A confirm on a draft that already has a `writtenSpendingRowId` returns that row instead of writing again; a retry after a Budget line was created reuses that line.

*Limitation, accepted:* in-memory state is lost on restart or a second instance. A restart mid-draft loses an unconfirmed draft — an annoyance, not data loss, because nothing unconfirmed was ever written. Single instance, no autoscaling.

*Alternatives considered:* a database — real durability, disproportionate for one user's unconfirmed drafts. Client-held state — the client could then assert a row was already written, which is exactly the claim that must not be forgeable.

### Budget lines are re-read on every capture, not cached

With two people logging against the same budget, a line one of them creates has to be visible to the other on the very next capture; a server-side TTL would hand one of them a stale list for the length of that TTL and push them toward proposing a duplicate line. The list is ~45 rows and a single request, so the saved latency does not pay for the staleness.

### Write order: Budget line first, then Spending row

Where the user accepted a proposed Budget line, create the line, then the Spending row related to it. The reverse order would leave an unrelated Spending row — invisible in the rollups and easy to miss — whereas an orphan Budget line is visible, harmless, and reused on retry.

### Authentication is delegated to an identity-aware proxy

The app writes to a live Notion budget and holds a DeepSeek key, so it cannot be open. Rather than build authentication, the deployment sits behind **Cloudflare Access**, restricted to the two owners' identities. The app has no login screen, no password, no session cookie of its own and no session store.

This is less code *and* a stronger position than a shared passphrase: no shared secret to leak or rotate, no login endpoint to brute-force, and revoking one person is an Access policy change rather than a redeploy. Both identities are signed in independently by construction, so neither can sign the other out. It also yields a verified per-person identity at no cost, should the attribution deliberately excluded above ever be wanted.

**The origin must not be reachable directly.** A proxy is only a boundary if traffic cannot go around it. Access forwards an identity header, and trusting that header alone is the classic failure of this setup: anyone who can reach the origin can set it themselves. Two things are required, not one:

1. The app verifies the **`Cf-Access-Jwt-Assertion` request header** on **every** request — signature, audience and expiry — and never trusts the plain identity header on its own. Identity comes from the verified token's payload, not from `Cf-Access-Authenticated-User-Email`.

   It is deliberately *not* the `CF_Authorization` cookie. Cloudflare does not guarantee the cookie is passed, and an installed iOS PWA has its own cookie jar — so the cookie is the carrier most likely to be missing on the iPhone, producing an intermittent, per-device refusal that looks like the app is broken for no reason. The header, by contrast, is added to every request Access forwards.

   Keys are fetched from `https://<team-domain>/cdn-cgi/access/certs` and matched by the token's `kid`, rather than pinned. Access rotates its signing key every six weeks and retires the previous one seven days later, so a pinned key would begin refusing both owners about six weeks after deployment — silently, and at exactly the point where nobody is in a position to debug it.
2. The origin accepts traffic only from Cloudflare — via a Cloudflare Tunnel by preference, so the host needs no inbound public port at all, otherwise an origin firewall restricted to Cloudflare addresses.

Either one alone leaves a bypass. A local development bypass is acceptable only behind an explicit flag that refuses to start under production configuration.

*Alternatives considered:* a shared passphrase with a signed session cookie — self-contained and free, but a secret two people share, text to each other and never rotate, plus a login endpoint that has to be rate-limited correctly. A self-hosted proxy such as Authelia — no third party, but another service to run and patch for two users. **European alternatives were considered and rejected**: no EU vendor sells this product shape, and assembling one from a hosted IdP (Zitadel, Ory) plus a self-hosted proxy forfeits exactly the simplicity that made this the choice. Revisit if data residency, rather than vendor preference, becomes a requirement.

### Spending limits on the model endpoints

Authentication bounds *who* can call the capture endpoints; it does nothing to bound what they cost. A looping client or a carelessly-used session can burn the DeepSeek balance without limit, and that failure is silent — it surfaces on a billing page, not in the budget. The capture endpoints are therefore rate-limited per identity, with a daily ceiling set well above two people logging spends on a trip and far below anything that would matter financially.

### Trip timezone is configuration

"Yesterday" must resolve against Melbourne, not UTC, or spends logged late in the evening land on the wrong day. The timezone is a config value (`Australia/Melbourne` for this trip) and is injected into the prompt as the current local date.

### Config binds names, not just IDs

Config carries the two data source IDs, the exact property names, the category list, the currency options and default, and the timezone. Notion select options are matched literally, so `EURO` and `Accomodation` are config values rather than constants someone will "fix" later.

## Risks / Trade-offs

**Long supermarket receipts lose fidelity at 1300px** → The 1024-token cap is DeepSeek's, not ours, and a metre-long Woolworths receipt will not survive it legibly. Mitigated by only ever needing the *total*, which is large and near the end, and by preserving the long axis when downscaling. The confirmation gate is the real backstop. If totals prove unreliable in practice, DeepSeek accepts many images per request, so a tall receipt could be split into overlapping crops.

**A wrong amount is confirmed by reflex** → The confirmation gate is worthless if tapping through becomes automatic. Mitigated by flagging low-confidence and assumed fields visually rather than presenting every draft identically, so attention lands where it is needed.

**Matching quietly degrades as the trip goes on** → Real spends will not resemble planned lines ("Coffee's and snacks" was planned at 88 × $10). Matching is per-call against the current line list, so it tracks the budget as it changes; proposing a new line is the designed escape hatch rather than a failure mode.

**Budget lines change while a draft is open** → A matched line could be renamed or deleted between extraction and confirmation. The relation is by ID, so a rename is harmless; a deleted line causes the write to fail and is reported as a failure with the draft preserved.

**Notion API version drift** → `data_source_id` addressing requires `Notion-Version: 2025-09-03`+. Pin the version header explicitly rather than relying on an SDK default, since a silent downgrade would reintroduce exactly the `database_id` ambiguity this database already exhibits.

**DeepSeek model IDs churn** → `deepseek-v4-flash-vision-exp` was retired within a month of release, superseded by `deepseek-flash`. The model ID is config, and an unknown-model error surfaces as a clear startup or extraction failure rather than a silent fallback.

**The iPhone never gets an install prompt** → iOS has no `beforeinstallprompt`. Installing means Safari → Share → Add to Home Screen, in Safari specifically, and nothing in the browser hints at it. Android gets a real prompt. Without an iOS-only in-app hint the app simply never gets installed on her phone, and an uninstalled PWA is just a tab she loses. Mitigated by detecting iOS Safari outside standalone mode and showing the steps.

**Installing after logging in loses the session** → An installed iOS PWA has its own cookie jar, separate from Safari's, so logging in first and installing second lands on the login screen again inside the installed app. Confusing enough on day one to make someone abandon the app. Mitigated by the hint telling her to install first, then log in — and by verifying that ordering rather than assuming it.

**Safari evicts the session after a week of disuse** → Safari caps script-writable storage at seven days without interaction. The session is a server-set httpOnly cookie, which should fall outside that cap, and installed PWAs get more leeway — but "should" is carrying real weight there. Verify across an actual week before departure; being silently signed out mid-trip is exactly when nobody will debug it.

**Access re-authentication interrupts a capture** → Access sessions expire on a policy-set schedule, and an expiry mid-capture bounces the user into a login flow. Set the session duration to the length of the trip, and verify on both phones that an expiry recovers cleanly rather than silently losing an unconfirmed draft.

**The proxy becomes a dependency between her and logging a coffee** → A Cloudflare or Access outage makes the app unreachable even when the app and Notion are both healthy. Same fallback as below: write the spend into Notion by hand.

**Identity header trusted without the JWT** → The single most likely way to get this deployment wrong, and it fails open rather than closed, so nothing visibly breaks. Both halves of the decision above — JWT verification *and* a locked origin — must be verified independently, because either alone looks like it works.

**The cookie is not the header** → Access delivers the same JWT as a `Cf-Access-Jwt-Assertion` request header and a `CF_Authorization` cookie, and only the header is guaranteed. Verifying the cookie would refuse requests Access had already authenticated — intermittently, and per device, because an installed iOS PWA has its own cookie jar. The same mechanism as "Installing after logging in loses the session", and equally hard to diagnose from Australia.

**Single instance is a single point of failure** → Accepted. If the host is down, the user writes the spend in Notion by hand, as they do today.

## Migration Plan

Greenfield — no data migration, no existing users, nothing to roll back into.

Deployment sequence:
1. Build and test locally with the development auth bypass on. Cloudflare is a deployment-time concern: Access exists to prove identity to a *reachable* origin, so the two Access values are required by configuration only while the bypass is off. A prototype therefore needs no Cloudflare account, no domain and no tunnel.
2. Create a Notion internal integration; share **both** the `💸 Budget` and Spending databases with it — and **only** those two. Do not share the parent `AUSTRALIA` page: sharing a page cascades to its children and would hand the token the entire trip workspace. This is the only mitigation on this page that still helps if the host itself is compromised and the token is taken.
3. Verify against a scratch duplicate of both databases first. The specs forbid touching existing rows, but the first write should not be into the live trip budget.
4. Stand up the Cloudflare Tunnel and place an Access application in front of the hostname, restricted to the two owners' identities, with the session duration set to the length of the trip. Do this before the host is reachable from outside: a published tunnel route is open to the internet until the Access application exists in front of it.
5. Deploy, turn the bypass off and supply the two Access values, install the PWA to the phone home screen, and log one real spend end to end before relying on it.

Rollback is deleting the deployment; the Notion data stands on its own.

## Open Questions

- Whether to keep the uploaded receipt image (attached to the Spending row, or discarded after extraction). Not required by any spec; decide once it is clear whether the receipts are ever wanted again.
