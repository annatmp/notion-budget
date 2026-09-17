# Budget Tracker

A mobile-first PWA for logging trip spending into a Notion budget. Photograph a
receipt or type a short sentence like `coffee 8 bucks`; the app parses it,
matches it to a budget line, and shows you a draft to review. **Nothing is
written to Notion until you confirm it** — there is no silent-write path,
including for photos.

Two people share one budget and log against it from two devices, one iPhone and
one Android. The app has no accounts of its own: sign-in is handled upstream by
Cloudflare Access.

## Requirements

- **Node.js 20.19.0 or newer.** The pinned version is in `.nvmrc`; with nvm, run
  `nvm use`. Check with `node --version`.
- A GitHub Copilot or similar agent is not required to run the app.

## Setup

```bash
nvm use                 # or otherwise install Node 20.19+
npm install
cp .env.example .env.local
```

Then fill in `.env.local`. Every variable is described in `.env.example`; the
groups are:

| Group | What it covers |
| --- | --- |
| Notion binding | Integration token, API version, the two data source IDs, and the exact property names to read and write |
| Budget vocabulary | Category list, currency options, default currency, trip timezone |
| DeepSeek | API key and model ID |
| Access control | Cloudflare Access team domain and audience, plus the local dev bypass and the daily capture ceiling |

The app validates all of this at startup and **refuses to start** if anything is
missing, naming the value it needs. That is deliberate: a half-configured app
would otherwise write to the wrong place.

`npm install` also configures the git pre-commit hook that refuses a commit
containing a credential or a `.env` file. If you cloned before running it, or if
hooks look inactive, set it up directly:

```bash
git config core.hooksPath hooks
```

## Running locally

```bash
npm run dev
```

Serves on <http://localhost:3000>. Because Cloudflare Access is not in front of
your machine, local development needs the bypass:

```bash
DEV_AUTH_BYPASS=true   # in .env.local
```

The bypass refuses to start when `APP_ENV=production`, so it cannot be left on
in a deployment by accident.

## Checks

```bash
npm test          # unit tests
npm run typecheck # tsc --noEmit
npm run lint      # eslint
npm run format    # prettier, writes
npm run format:check
```

Run `typecheck`, `lint` and `test` before committing; do not commit a failing
build.

## Deploying

The app is designed for a **single always-on instance with no autoscaling**.
Unconfirmed drafts are held in memory, so a second instance would not see a
draft created by the first.

- Reached through a **Cloudflare Tunnel** rather than a public inbound port, so
  the host exposes no directly reachable origin.
- Behind **Cloudflare Access**, restricted to the two owners' identities. Set
  the Access session duration to the length of the trip.
- The app verifies the `CF-Authorization` JWT on every request. It never trusts
  the forwarded identity header on its own — see `design.md` in the change
  folder for why both halves are required.

If the host is down, log the spend in Notion by hand. The app only ever appends
rows; corrections happen in Notion.
