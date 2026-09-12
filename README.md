# calendars

A stateless Cloudflare Worker that serves iCalendar feeds at
`cal.janejeon.dev/<path>`. Subscribe to one from any calendar client that
supports ICS subscriptions (Fastmail, Google Calendar, Apple Calendar).
It currently serves Codex weekly usage-limit resets and Downtown San Mateo
events. A small React/Vite frontend is deployed at `cal.janejeon.com`.

Feed URL:

```
https://cal.janejeon.dev/codex-resets.ics
https://cal.janejeon.dev/dtsm-events.ics
```

## What it does

The Worker fetches the reset history and current status from the [Codex
Resets](https://codex-resets.com) API and builds a calendar:

- Every past reset, as an all-day event, `regular` or `banked` distinguishable.
- A scheduled reset announcement, as a timed event when an instant is known,
  or an all-day event when only a date is known.
- An active reset forecast, as an all-day event.

There is no cron and there are no credentials in Worker code. Serialized
responses are cached at Cloudflare's edge and retained in Workers KV for
outage fallback.

The Downtown San Mateo feed takes one open-ended, paginated daily snapshot of
all events exposed by the DSMA API and stores explicit useful fields in
normalized D1 tables. The default feed selects the configured B Street and
Central Park venue IDs at read time; images are discarded. Filtered URLs query
the same catalog without re-scraping. Ended events are retained and never
fetched again. Upstream date-time strings are interpreted as
`America/Los_Angeles` wall time, even when the API's timezone metadata
disagrees.

The DTSM feed accepts comma-separated venue, organizer, and category IDs:

```
https://cal.janejeon.dev/dtsm-events.ics?venues=1201,1137
https://cal.janejeon.dev/dtsm-events.ics?organizers=700&categories=80,81
```

Within one parameter, an event can match any listed ID. Supplying multiple
parameters requires a match in each group. Omitted groups are unrestricted.
With no query parameters, the feed keeps its six configured default venues.
Each DTSM response is cached for one hour, while the shared D1 catalog refreshes
from DSMA at most once per day. The default KV fallback is retained
indefinitely. Inactive custom-filter variants expire from KV after 30 days;
regularly polled subscriptions renew their variant during hourly rebuilds.

Active, time-sensitive delivery (forecasts with deadlines, reset
confirmations) is handled by the tracker's own Telegram channel,
[`t.me/codex_resets`](https://t.me/codex_resets). This feed is the
passive view: a calendar you can look at, not something that pages you.

## Subscribing

In Fastmail: Calendars → add subscription → paste the feed URL above.
Any client that supports "subscribe to a calendar by URL" (as opposed to
CalDAV two-way sync) will work.

## Workspace development

```sh
npm ci
npx swarp direnv allow      # let direnv autoload .env
npx swarp secrets refresh   # resolve .env.template into .env from 1Password
npm run dev                 # Worker and frontend dev servers
npm test                    # all package tests
npm run test:coverage       # all packages, 100% thresholds
npm run lint                # TypeScript, Prettier, and frontend ESLint/Oxlint
npm run format              # write formatting in all packages
npm run build               # backend dry-run bundle and frontend Vite build
```

The individual projects live in `backend/`, `frontend/`, and `shared/`. Each
has the same `dev`, `test`, `test:coverage`, `lint`, `format`, and `build`
commands. Backend-only commands are available through the root as
`npm run db:generate`, `npm run db:migrate:local`, and
`npm run test:e2e`.

Nx owns orchestration and affected execution; npm workspaces own package
linking. A change in `shared/` therefore affects both applications, while a
frontend-only change does not select the backend tests or D1 checks.

Deploys run from GitHub Actions when a change merges to master. The Worker
deploys to `cal.janejeon.dev`; the static frontend deploys to
`cal.janejeon.com`.

See `AGENTS.md` for the full design rationale and the facts this feed
was built on.
