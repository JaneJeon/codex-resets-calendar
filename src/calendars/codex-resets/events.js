import { isValidURL } from 'ics'

const DOMAIN = 'cal.janejeon.com'
const SCHEDULED_TOLERANCE_MS = 30 * 60 * 1000

export function laDate(isoString) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(isoString))
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return [Number(byType.year), Number(byType.month), Number(byType.day)]
}

export function addDays([year, month, day], days) {
  const date = new Date(Date.UTC(year, month - 1, day + days))
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
}

// DTSTAMP and LAST-MODIFIED come from the source's own timestamp, never the
// wall clock, so identical input serializes identically. ics writes an ISO
// string verbatim, so it must be milliseconds.
function stampFields(isoString) {
  const stamp = Date.parse(isoString)
  return { timestamp: stamp, lastModified: stamp }
}

// ics rejects the whole calendar on an invalid URL, so a bad source URL is
// dropped from its one event instead.
function sourceFields(source) {
  const url = source?.url
  if (typeof url !== 'string') return {}
  return isValidURL(url) ? { description: url, url } : { description: url }
}

function pastResetEvent(reset) {
  const start = laDate(reset.announced_at)
  const isBanked = reset.reset_type === 'banked'
  return {
    uid: `${reset.id}@${DOMAIN}`,
    title: isBanked ? 'Codex Reset (banked)' : 'Codex Reset',
    categories: [reset.reset_type],
    ...sourceFields(reset.source),
    start,
    end: addDays(start, 1),
    ...stampFields(reset.announced_at),
    transp: 'TRANSPARENT'
  }
}

function scheduledResetEvent(scheduled) {
  const isBanked = scheduled.reset_type === 'banked'
  const base = {
    uid: `${scheduled.id}@${DOMAIN}`,
    title: `Codex Reset announced${isBanked ? ' (banked)' : ''}`,
    categories: ['scheduled'],
    ...sourceFields(scheduled.source),
    ...stampFields(scheduled.announced_at),
    transp: 'TRANSPARENT'
  }

  if (scheduled.scheduled_for) {
    const center = Date.parse(scheduled.scheduled_for)
    return {
      ...base,
      start: center - SCHEDULED_TOLERANCE_MS,
      startInputType: 'utc',
      startOutputType: 'utc',
      end: center + SCHEDULED_TOLERANCE_MS
    }
  }

  const start = laDate(scheduled.announced_at)
  return {
    ...base,
    start,
    end: addDays(start, 1)
  }
}

function watchEvent(watch) {
  const percent =
    watch.reset_chance_percent != null ? `, ${watch.reset_chance_percent}%` : ''
  return {
    uid: `watch-${watch.observed_at}@${DOMAIN}`,
    title: `Codex Reset forecast (${watch.level}${percent})`,
    categories: ['forecast'],
    ...sourceFields(watch.source),
    start: laDate(watch.observed_at),
    end: addDays(laDate(watch.expires_at), 1),
    ...stampFields(watch.observed_at),
    transp: 'TRANSPARENT'
  }
}

export function buildEvents(resets, status = {}) {
  const events = resets.map(pastResetEvent)
  const historyIds = new Set(resets.map(reset => reset.id))

  const scheduled = status.scheduled_reset
  if (scheduled && !historyIds.has(scheduled.id)) {
    events.push(scheduledResetEvent(scheduled))
  }

  const watch = status.active_watch
  if (watch) {
    events.push(watchEvent(watch))
  }

  const deduped = new Map()
  for (const event of events) {
    deduped.set(event.uid, event)
  }
  return [...deduped.values()]
}
