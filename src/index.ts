import { findCalendar } from './calendars/index.js'
import { UpstreamError } from './errors.js'
import { serializeCalendar } from './lib/ics.js'

const NO_STORE = { 'Cache-Control': 'no-store' }
const CONTENT_TYPE = 'text/calendar; charset=utf-8'

function feedResponse(body: string, cacheTtlSeconds: number): Response {
  return new Response(body, {
    headers: {
      'Content-Type': CONTENT_TYPE,
      'Cache-Control': `public, max-age=${cacheTtlSeconds}`
    }
  })
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    const calendar = findCalendar(pathname)

    if (!calendar) {
      return new Response('Not found', { status: 404 })
    }

    try {
      const body = calendar.buildResponse
        ? await calendar.buildResponse(env)
        : serializeCalendar(await calendar.buildEvents(), {
            name: calendar.name
          })
      return feedResponse(body, calendar.cacheTtlSeconds)
    } catch (error: unknown) {
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
