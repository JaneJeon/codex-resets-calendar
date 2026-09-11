# calendars

A stateless Cloudflare Worker that serves iCalendar feeds at
`cal.janejeon.dev/<path>`. Subscribe to one from any calendar client that
supports ICS subscriptions (Fastmail, Google Calendar, Apple Calendar).
Today it serves one calendar: Codex weekly usage-limit resets.

Feed URL:

```
https://cal.janejeon.dev/codex-resets.ics
```

## What it does

The Worker fetches the reset history and current status from the [Codex
Resets](https://codex-resets.com) API and builds a calendar:

- Every past reset, as an all-day event, `regular` or `banked` distinguishable.
- A scheduled reset announcement, as a timed event when an instant is known,
  or an all-day event when only a date is known.
- An active reset forecast, as an all-day event.

There is no database, no cron, and no credentials in Worker code. The
serialized response is cached at Cloudflare's edge for 15 minutes and
retained in Workers KV with a one-hour freshness window. After that
window the Worker refreshes upstream; if refresh fails, it serves the
last successful response indefinitely.

Active, time-sensitive delivery (forecasts with deadlines, reset
confirmations) is handled by the tracker's own Telegram channel,
[`t.me/codex_resets`](https://t.me/codex_resets). This feed is the
passive view: a calendar you can look at, not something that pages you.

## Subscribing

In Fastmail: Calendars → add subscription → paste the feed URL above.
Any client that supports "subscribe to a calendar by URL" (as opposed to
CalDAV two-way sync) will work.

## Development

```sh
npm ci
npx swarp direnv allow      # let direnv autoload .env
npx swarp secrets refresh   # resolve .env.template into .env from 1Password
npm run dev     # local dev server
npm test        # unit + integration tests
npm run test:e2e  # hits the real upstream API; needs network
```

Deploys run from GitHub Actions when a change merges to master.

See `AGENTS.md` for the full design rationale and the facts this feed
was built on.
