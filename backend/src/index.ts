import { findCalendar, type CalendarDefinition } from '@/calendars/index.js'
import { UpstreamError } from '@/errors.js'
import { serializeCalendar } from '@/lib/ics.js'
import { withResponseCache } from '@/lib/response-cache.js'

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

export async function buildCalendarBody(
  calendar: CalendarDefinition,
  env: Env
): Promise<string> {
  const build = async () =>
    serializeCalendar(await calendar.buildEvents(env), { name: calendar.name })

  return calendar.responseCache
    ? withResponseCache({
        store: env.CALENDAR_CACHE,
        key: calendar.responseCache.key,
        freshnessSeconds: calendar.responseCache.freshnessSeconds,
        label: calendar.name,
        build
      })
    : build()
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url)
    const calendar = findCalendar(pathname)

    if (!calendar) {
      return new Response('Not found', { status: 404 })
    }

    try {
      const body = await buildCalendarBody(calendar, env)
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
