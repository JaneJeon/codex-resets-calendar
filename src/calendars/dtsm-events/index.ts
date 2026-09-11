import { UpstreamError } from '../../errors.js'
import { buildEvents } from './events.js'
import {
  acquireLease,
  persistSnapshot,
  readEvents,
  readOngoingStart,
  readSyncState,
  recordFailure
} from './repository.js'
import { DOWNTOWN_VENUE_IDS, fetchEvents } from './upstream.js'

const TIME_ZONE = 'America/Los_Angeles'

export function localDateTime(now: Date): string {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-CA', {
      timeZone: TIME_ZONE,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      hourCycle: 'h23'
    })
      .formatToParts(now)
      .map(part => [part.type, part.value])
  )
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`
}

async function syncAndRead(db: D1Database, now: Date) {
  const nowSeconds = Math.floor(now.getTime() / 1000)
  const state = await readSyncState(db)
  const defaultFilter = { venueIds: DOWNTOWN_VENUE_IDS }
  if (state.next_attempt_at > nowSeconds) {
    if (state.last_success_at === null)
      throw new UpstreamError('DTSM events refresh is waiting to retry')
    return readEvents(db, defaultFilter)
  }

  if (!(await acquireLease(db, nowSeconds))) {
    const stored = await readEvents(db, defaultFilter)
    if (state.last_success_at !== null) return stored
    throw new UpstreamError('DTSM events refresh is already in progress')
  }

  const currentLocal = localDateTime(now)
  const ongoingStart = await readOngoingStart(db, currentLocal)
  const today = currentLocal.slice(0, 10)

  try {
    const sourceEvents = await fetchEvents({
      startDate: ongoingStart?.slice(0, 10) ?? today
    })
    if (sourceEvents.length === 0)
      throw new UpstreamError('DTSM events returned an empty snapshot')
    await persistSnapshot(db, sourceEvents, nowSeconds, currentLocal)
  } catch (error: unknown) {
    await recordFailure(db, nowSeconds, state.last_success_at !== null)
    if (state.last_success_at !== null) {
      console.warn('DTSM events refresh failed, serving stored events', error)
      return readEvents(db, defaultFilter)
    }
    throw error instanceof UpstreamError
      ? error
      : new UpstreamError('DTSM events refresh failed')
  }
  return readEvents(db, defaultFilter)
}

export default {
  path: '/dtsm-events.ics',
  name: 'Downtown San Mateo Events',
  cacheTtlSeconds: 24 * 60 * 60,
  responseCache: {
    key: 'dtsm-events.ics',
    freshnessSeconds: 24 * 60 * 60
  },

  async buildEvents(env: Env) {
    try {
      return buildEvents(await syncAndRead(env.CALENDAR_DB, new Date()))
    } catch (error: unknown) {
      if (error instanceof UpstreamError) throw error
      throw new UpstreamError('DTSM database unavailable')
    }
  }
}
