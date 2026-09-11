import { findCalendar } from './calendars/index.js'
import { UpstreamError } from './errors.js'
import { serializeCalendar } from './ics.js'

// A failure must never be served from cache in place of a real feed.
const NO_STORE = { 'Cache-Control': 'no-store' }

export default {
  async fetch(request) {
    const { pathname } = new URL(request.url)
    const calendar = findCalendar(pathname)

    if (!calendar) {
      return new Response('Not found', { status: 404 })
    }

    try {
      const events = await calendar.buildEvents()
      const body = serializeCalendar(events, { name: calendar.name })

      return new Response(body, {
        headers: {
          'Content-Type': 'text/calendar; charset=utf-8',
          'Cache-Control': `public, max-age=${calendar.cacheTtlSeconds}`
        }
      })
    } catch (error) {
      if (error instanceof UpstreamError) {
        return new Response('Upstream unavailable', {
          status: 502,
          headers: NO_STORE
        })
      }
      console.error(`${calendar.name} feed failed`, error)
      return new Response('Internal error', { status: 500, headers: NO_STORE })
    }
  }
}
