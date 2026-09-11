# AGENTS.md

Operational facts for this repo. Read this before changing `src/`. The
full design rationale and history live on Linear issue JANE-240.

## What this is

One stateless Cloudflare Worker serving several iCalendar feeds, one per
path, each derived on every request from its upstream source. No
database, no cron, and no secret inside the Worker (the Cloudflare
credentials in `.env` are for wrangler only). Today there is one
calendar: Codex resets at `/codex-resets.ics`, built from two upstream
GETs against `https://codex-resets.com`. No Telegram or Slack code —
those are out of scope by design.

## Calendars

Each calendar lives in `src/calendars/<name>/` and default-exports
`{ path, name, cacheTtlSeconds, buildEvents() }`. `buildEvents` resolves
to `ics` event attributes and throws `UpstreamError` (`src/errors.js`)
when its source fails. `src/calendars/index.js` is the registry.
`src/index.js` routes an exact path match to its calendar; every other
path, including `/`, is a 404.

To add a calendar: create its folder, export that object, add it to the
registry, and add tests under `test/unit/calendars/<name>/` and
`test/integration/`. The registry test checks that paths are unique
`.ics` paths and that TTLs are positive whole seconds.

`cacheTtlSeconds` becomes `Cache-Control: public, max-age=<ttl>` on a
successful response. Error responses always carry
`Cache-Control: no-store`: an `UpstreamError` is a 502, and anything
else (for example `ics` rejecting an event) is a logged 500.

The sections from the danger list through Failure policy are specific
to the Codex resets calendar (`src/calendars/codex-resets/`).

## The danger list

Four mistakes are cheap to make here and expensive to notice, because
each produces a feed that looks fine and is wrong:

1. Slicing a UTC timestamp to get a calendar date. 44% of the historical
   resets fall on a different day in `America/Los_Angeles` than in UTC.
   Always convert to the LA date first (`laDate` in
   `src/calendars/codex-resets/events.js`).
2. All-day `DTEND` is exclusive. One day is `DTSTART;VALUE=DATE:20260907`
   with `DTEND;VALUE=DATE:20260908`.
3. Hand-assembling ICS text. Serialization belongs to the `ics` library
   (`src/ics.js`), and it validates strictly: an unknown attribute or an
   invalid `url` fails the whole calendar. So event builders pass only
   `ics` attributes and drop a bad URL from its one event. SUMMARY text
   goes in `title` (a missing title becomes "Untitled event"), and
   `timestamp` must be milliseconds (an ISO string is written verbatim
   as an invalid DTSTAMP). The library folds lines by character, not by
   75 octets; today's feed text is ASCII, so lines stay within 75 octets.
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
place. `buildEvents` in `src/calendars/codex-resets/events.js` dedupes
by UID and drops a
`scheduled_reset` whose id already appears in history.

## Failure policy

| Condition                                  | Response                                                                         |
| ------------------------------------------ | -------------------------------------------------------------------------------- |
| `/resets` fails, times out, or returns 5xx | 502, `no-store`                                                                  |
| `/resets` returns 200 with an empty array  | 502, `no-store` (an empty calendar would tell subscribers to delete every event) |
| `/resets` returns 429                      | 502, `no-store`, `Retry-After` logged, no retry                                  |
| `/status` fails in any way                 | serve the history-only feed, `console.warn`                                      |
| `ics` rejects an event                     | 500, `no-store`, `console.error`                                                 |

## Local setup and secrets

`.env.template` holds 1Password references for `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID`. `npx swarp secrets refresh` resolves it
into `.env`, and `.envrc` autoloads that through direnv
(`npx swarp direnv allow` once per checkout). Wrangler authenticates
from those two variables, so there is no `wrangler login`. Run
commands that need them under `direnv exec . <command>`.

Gotcha: wrangler also reads `.env` by itself, and in local development
it loads those values into the Worker's `env`. The API token is
therefore visible to Worker code under `wrangler dev`. Never read it
from `env` in `src/`.

## Deploy

```sh
npx wrangler dev     # verify locally, curl and parse the feed before deploying
npx wrangler deploy
```

The Cloudflare account id and workers.dev subdomain are not recorded in
this repo (it is public). They live in Jane's private notes.

After any change to `src/`, update the Craft doc
`Codex reset watch — current setup` with what actually changed and
what was verified, per that folder's README.

## Testing

- Unit tests (`test/unit/`) cover the pure logic: LA-date conversion,
  all-day arithmetic, UID stability, and the serialized output parsed
  back with `ical.js`.
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
