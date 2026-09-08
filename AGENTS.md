# AGENTS.md

Operational facts for this repo. Read this before changing `src/`. The
full design rationale and history live on Linear issue JANE-240.

## What this is

One stateless Cloudflare Worker. It serves `text/calendar` at
`/codex-resets.ics`, derived on every request from two upstream GETs
against `https://codex-resets.com`. No database, no cron, no secret of
any kind, no Telegram or Slack code — those are out of scope by design.

## The danger list

Four mistakes are cheap to make here and expensive to notice, because
each produces a feed that looks fine and is wrong:

1. Slicing a UTC timestamp to get a calendar date. 44% of the historical
   resets fall on a different day in `America/Los_Angeles` than in UTC.
   Always convert to the LA date first (`laDateString` in `src/events.js`).
2. All-day `DTEND` is exclusive. One day is `DTSTART;VALUE=DATE:20260907`
   with `DTEND;VALUE=DATE:20260908`.
3. ICS line endings must be CRLF, folding at 75 octets (not characters),
   never splitting a multi-byte UTF-8 sequence.
4. Inventing a time: no midpoint between two bounds, no recentering, no
   start time derived from an upper bound. The one bounded exception is
   the 30-minute symmetric tolerance around `scheduled_for` (see below),
   which brackets a single real instant rather than blending two bounds.

## The upstream API

- `GET /api/v1/resets?limit=100&cursor=...` — cursor-paginated history.
  `reset_type` is exactly `regular` or `banked`; there is no `full`.
- `GET /api/v1/status` — `latest_reset` (ignored; it duplicates the
  newest history entry), `scheduled_reset` (an announcement awaiting
  execution; a passed `scheduled_for` does not imply completion), and
  `active_watch` (an AI forecast, no `reset_type`, no `id`, so banked
  detection is structurally impossible for a forecast and its UID is
  synthesized from `observed_at`).
- `forecast_window` is a display string ("soon" by default), not a time
  source. Never parse it for a time. Use `expires_at` / `scheduled_for`.
- 429 carries `Retry-After`. The Worker never retries in-request; it
  logs the value and returns 502. The next poll is the retry.

## Timed vs. all-day

| Source                                       | Event                                                                     |
| -------------------------------------------- | ------------------------------------------------------------------------- |
| `scheduled_reset` with `scheduled_for`       | Timed: `scheduled_for` minus 30 min to plus 30 min                        |
| `scheduled_reset` with `scheduled_for: null` | All-day, LA date of `announced_at`                                        |
| `active_watch`                               | All-day, LA date of `observed_at` to LA date of `expires_at` plus one day |
| Past reset                                   | All-day, LA date of `announced_at`                                        |

The 30-minute tolerance is chosen, not measured (see JANE-240). Revisit
once real lead-time data accumulates.

## Event identity and dedupe

UID is `<id>@codex-resets-calendar.janejeon.workers.dev`. The domain
part must match the deploy host exactly — changing it orphans every
event already on a subscriber's calendar. A `scheduled_reset` shares its
id with the eventual history entry (both are sourced from the same X
post), so when it converts to a past reset the same UID takes over in
place. `buildEvents` in `src/events.js` dedupes by UID and drops a
`scheduled_reset` whose id already appears in history.

## Failure policy

| Condition                                  | Response                                                             |
| ------------------------------------------ | -------------------------------------------------------------------- |
| `/resets` fails, times out, or returns 5xx | 502                                                                  |
| `/resets` returns 200 with an empty array  | 502 (an empty calendar would tell subscribers to delete every event) |
| `/resets` returns 429                      | 502, `Retry-After` logged, no retry                                  |
| `/status` fails in any way                 | serve the history-only feed, `console.warn`                          |

## Deploy

```sh
npx wrangler login   # once per machine
npx wrangler dev     # verify locally, curl and parse the feed before deploying
npx wrangler deploy
```

The Cloudflare account id and workers.dev subdomain are not recorded in
this repo (it is public). They live in Jane's private notes.

After any change to `src/`, update the Craft doc
`Codex reset watch — current setup` with what actually changed and
what was verified, per that folder's README.

## Testing

- Unit tests (`test/unit/`) cover the pure logic: escaping, folding,
  LA-date conversion, all-day arithmetic, UID stability.
- Integration tests (`test/integration/`) exercise
  `exports.default.fetch()` from `cloudflare:workers` against a stubbed
  `globalThis.fetch`, covering routing and the failure table above.
- E2E tests (`test/e2e/`) hit the real API and, if `DEPLOYED_URL` is
  set, the deployed Worker. Gated behind `RUN_E2E=1` so a normal
  `npm test` run stays offline and green.
- Fixtures in `test/fixtures/` are captured upstream responses.
  `resets.json` is a real capture; assert **at least** its event count,
  not exactly, since history grows. `status-scheduled.json` and
  `status-watch.json` are hand-built, because live `/status` returned
  both fields null on the day this was built.
