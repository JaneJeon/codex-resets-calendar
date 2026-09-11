import { UpstreamError } from '../../errors.js'
import { serializeCalendar } from '../../lib/ics.js'
import { withResponseCache } from '../../lib/response-cache.js'
import { buildEvents } from './events.js'
import { fetchResets, fetchStatus, type Status } from './upstream.js'

const RESPONSE_CACHE_KEY = 'codex-resets.ics'
const RESPONSE_CACHE_FRESHNESS_SECONDS = 60 * 60

export default {
  path: '/codex-resets.ics',
  name: 'Codex Resets',
  cacheTtlSeconds: 15 * 60,

  async buildResponse(env: Env) {
    return withResponseCache({
      store: env.CALENDAR_CACHE,
      key: RESPONSE_CACHE_KEY,
      freshnessSeconds: RESPONSE_CACHE_FRESHNESS_SECONDS,
      label: 'Codex Resets',
      build: async () =>
        serializeCalendar(await this.buildEvents(), { name: 'Codex Resets' })
    })
  },

  async buildEvents() {
    let resets
    try {
      resets = await fetchResets()
    } catch (error: unknown) {
      if (error instanceof UpstreamError && error.status === 429) {
        console.error('resets rate limited', { retryAfter: error.retryAfter })
      } else {
        console.error('resets fetch failed', error)
      }
      throw error instanceof UpstreamError
        ? error
        : new UpstreamError('resets fetch failed')
    }

    let status: Status = {}
    try {
      status = await fetchStatus()
    } catch (error: unknown) {
      console.warn('status fetch failed, serving history-only feed', error)
    }

    return buildEvents(resets, status)
  }
}
