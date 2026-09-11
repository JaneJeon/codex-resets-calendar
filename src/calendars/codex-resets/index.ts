import { UpstreamError } from '../../errors.js'
import { buildEvents } from './events.js'
import { fetchResets, fetchStatus, type Status } from './upstream.js'

export default {
  path: '/codex-resets.ics',
  name: 'Codex Resets',
  cacheTtlSeconds: 15 * 60,

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
