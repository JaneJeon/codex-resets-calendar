# codex-resets-calendar

A stateless Cloudflare Worker that serves Codex weekly usage-limit resets
as an iCalendar feed. Subscribe to it from any calendar client that
supports ICS subscriptions (Fastmail, Google Calendar, Apple Calendar).

Feed URL:

```
https://codex-resets-calendar.janejeon.workers.dev/codex-resets.ics
```

## What it does

On every request to `/codex-resets.ics`, the Worker fetches the reset
history and current status from the [Codex Resets](https://codex-resets.com)
API and builds a calendar with no stored state:

- Every past reset, as an all-day event, `regular` or `banked` distinguishable.
- A scheduled reset announcement, as a timed event when an instant is known,
  or an all-day event when only a date is known.
- An active reset forecast, as an all-day event.

There is no database, no cron, and no credentials. The feed is derived
from the upstream API and cached at Cloudflare's edge for 15 minutes.

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
npx swarp secrets refresh   # resolve .env.template into .env from 1Password
npx swarp direnv allow      # let direnv autoload .env
npm run dev     # local dev server
npm test        # unit + integration tests
npm run test:e2e  # hits the real upstream API; needs network
npm run deploy   # wrangler deploy
```

See `AGENTS.md` for the full design rationale and the facts this feed
was built on.
