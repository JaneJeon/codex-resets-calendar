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

That header is what actually caches the feed. `wrangler.jsonc` enables
Workers Cache (`"cache": { "enabled": true }`), so Cloudflare serves a
cached response without running the Worker, honoring `Cache-Control`
per RFC 9111. Without that block, the header alone caches nothing,
because a Worker runs in front of the zone cache. The cache key is the
request path and query string plus the Worker version, not the host:
every deploy starts cold, and all hostnames share one cache. Codex
resets is cached for 15 minutes. Sources:
https://developers.cloudflare.com/workers/cache/configuration/ and
https://developers.cloudflare.com/workers/cache/cache-keys/.

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

UID is `<id>@cal.janejeon.dev`. Changing the suffix gives every event a
new identity, so each subscriber's client deletes and re-creates the
whole calendar. The suffix has followed the feed's host
(`codex-resets-calendar.janejeon.workers.dev`, then briefly
`cal.janejeon.com`), moving only when subscriptions had to be re-added
at a new URL anyway. A `scheduled_reset` shares its
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

## Domain

Feeds are served from `cal.janejeon.dev`, not janejeon.com. janejeon.com
has Cloudflare Bot Fight Mode on, which challenges requests from cloud
IPs. On the first deploy it answered every request from GitHub Actions
with a 403 challenge, and calendar services such as Fastmail fetch
subscribed feeds from their own servers too. On the Free plan, Bot Fight
Mode can't be skipped for a single hostname, and janejeon.com needs it
for the home-lab services behind its wildcard DNS record.

On janejeon.dev, Bot Fight Mode is off. In its place, one WAF custom
rule, `(http.user_agent eq "")`, blocks requests without a User-Agent;
that was 89% of what Bot Fight Mode challenged on janejeon.com. Both are
zone settings in the Cloudflare dashboard, not in this repo. Every client
of the feed, tests included, must send a User-Agent.

## Local setup and secrets

`.env.template` holds 1Password references for `CLOUDFLARE_API_TOKEN`
and `CLOUDFLARE_ACCOUNT_ID`. Run `npx swarp direnv allow` once per
checkout, so direnv autoloads `.env` through `.envrc`, then
`npx swarp secrets refresh` to resolve the template into `.env`
(again whenever a secret rotates). Wrangler authenticates
from those two variables, so there is no `wrangler login`. Run
commands that need them under `direnv exec . <command>`.

Gotcha: wrangler also reads `.env` by itself, and in local development
it loads those values into the Worker's `env`. The API token is
therefore visible to Worker code under `wrangler dev`. Never read it
from `env` in `src/`. Tests turn this off: `vitest.config.js` sets
`CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV=false`, which also removes
wrangler's "Using secrets defined in .env" log.

Test output must stay clean in CI, not only locally. A test that
drives a failure path must mock the console method the Worker calls
and assert on the message. CI prints unmocked Worker logs as `stderr`
blocks, but local runs don't show them, so a clean local run proves
nothing about CI.

## Deploy

Merging to master deploys; never deploy from a laptop.
`.github/workflows/ci.yml` runs lint, tests, and
`wrangler deploy --dry-run` on every push and PR. On a push to master,
the `deploy` job runs `cloudflare/wrangler-action` with the
`CLOUDFLARE_API_TOKEN` secret and the `CLOUDFLARE_ACCOUNT_ID` variable.
It then waits for `https://cal.janejeon.dev/codex-resets.ics` to return
200 and runs only the `deployed feed` e2e block against it. The
live-upstream block is left out, so an upstream rate limit can't fail a
deploy that already happened.

Before merging a `src/` change, verify it locally: `npm run dev`, then
curl the feed and parse it.

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
