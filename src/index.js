import { fetchResets, fetchStatus } from './upstream.js'
import { buildEvents } from './events.js'
import { serializeCalendar } from './ics.js'

const FEED_PATH = '/codex-resets.ics'

export default {
  async fetch(request) {
    const url = new URL(request.url)

    if (url.pathname === '/') {
      return Response.redirect(new URL(FEED_PATH, url), 302)
    }

    if (url.pathname !== FEED_PATH) {
      return new Response('Not found', { status: 404 })
    }

    let resets
    try {
      resets = await fetchResets()
    } catch (error) {
      if (error.status === 429) {
        console.error('resets rate limited', { retryAfter: error.retryAfter })
      } else {
        console.error('resets fetch failed', error)
      }
      return new Response('Upstream unavailable', { status: 502 })
    }

    let status = {}
    try {
      status = await fetchStatus()
    } catch (error) {
      console.warn('status fetch failed, serving history-only feed', error)
    }

    const events = buildEvents(resets, status)
    const body = serializeCalendar(events, { name: 'Codex Resets' })

    return new Response(body, {
      headers: {
        'Content-Type': 'text/calendar; charset=utf-8',
        'Cache-Control': 'public, max-age=300, s-maxage=300'
      }
    })
  }
}
