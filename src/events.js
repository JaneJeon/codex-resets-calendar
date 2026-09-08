const DOMAIN = 'codex-resets-calendar.janejeon.workers.dev'
const SCHEDULED_TOLERANCE_MS = 30 * 60 * 1000

export function laDateString(isoString) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(new Date(isoString))
  const byType = Object.fromEntries(parts.map(part => [part.type, part.value]))
  return `${byType.year}${byType.month}${byType.day}`
}

export function addDaysToDateString(dateString, days) {
  const year = Number(dateString.slice(0, 4))
  const month = Number(dateString.slice(4, 6))
  const day = Number(dateString.slice(6, 8))
  const date = new Date(Date.UTC(year, month - 1, day))
  date.setUTCDate(date.getUTCDate() + days)
  const y = date.getUTCFullYear()
  const m = String(date.getUTCMonth() + 1).padStart(2, '0')
  const d = String(date.getUTCDate()).padStart(2, '0')
  return `${y}${m}${d}`
}

function pastResetEvent(reset) {
  const startDate = laDateString(reset.announced_at)
  const isBanked = reset.reset_type === 'banked'
  return {
    uid: `${reset.id}@${DOMAIN}`,
    summary: isBanked ? 'Codex BANKED reset' : 'Codex reset',
    categories: [reset.reset_type],
    description: reset.source?.url,
    url: reset.source?.url,
    allDay: true,
    startDate,
    endDate: addDaysToDateString(startDate, 1),
    dtstamp: reset.announced_at
  }
}

function scheduledResetEvent(scheduled) {
  const isBanked = scheduled.reset_type === 'banked'
  const base = {
    uid: `${scheduled.id}@${DOMAIN}`,
    summary: `Codex reset announced${isBanked ? ' (banked)' : ''}`,
    categories: ['scheduled'],
    description: scheduled.source?.url,
    url: scheduled.source?.url,
    dtstamp: scheduled.announced_at
  }

  if (scheduled.scheduled_for) {
    const center = new Date(scheduled.scheduled_for)
    return {
      ...base,
      allDay: false,
      start: new Date(center.getTime() - SCHEDULED_TOLERANCE_MS),
      end: new Date(center.getTime() + SCHEDULED_TOLERANCE_MS)
    }
  }

  const startDate = laDateString(scheduled.announced_at)
  return {
    ...base,
    allDay: true,
    startDate,
    endDate: addDaysToDateString(startDate, 1)
  }
}

function watchEvent(watch) {
  const startDate = laDateString(watch.observed_at)
  const expiresDate = laDateString(watch.expires_at)
  const percent =
    watch.reset_chance_percent != null ? `, ${watch.reset_chance_percent}%` : ''
  return {
    uid: `watch-${watch.observed_at}@${DOMAIN}`,
    summary: `Codex reset forecast (${watch.level}${percent})`,
    categories: ['forecast'],
    description: watch.source?.url,
    url: watch.source?.url,
    allDay: true,
    startDate,
    endDate: addDaysToDateString(expiresDate, 1),
    dtstamp: watch.observed_at
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
