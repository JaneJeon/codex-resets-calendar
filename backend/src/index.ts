import { findCalendar, type CalendarDefinition } from '@/calendars/index.js'
import { InvalidRequestError, UpstreamError } from '@/errors.js'
import { serializeCalendar } from '@/lib/ics.js'
import { withResponseCache } from '@/lib/response-cache.js'

const NO_STORE = { 'Cache-Control': 'no-store' }
const CONTENT_TYPE = 'text/calendar; charset=utf-8'
const CORS_ORIGIN = '*'

function withCors(response: Response): Response {
  response.headers.set('Access-Control-Allow-Origin', CORS_ORIGIN)
  return response
}

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
  env: Env,
  request: Request
): Promise<string> {
  const build = async () =>
    serializeCalendar(await calendar.buildEvents(env, request), {
      name: calendar.name
    })

  const cacheKey = calendar.responseCache?.key
  const resolvedCacheKey =
    typeof cacheKey === 'function' ? await cacheKey(request) : cacheKey
  const expirationTtl = calendar.responseCache?.expirationTtlSeconds
  const resolvedExpirationTtl =
    typeof expirationTtl === 'function'
      ? await expirationTtl(request)
      : expirationTtl

  return calendar.responseCache && resolvedCacheKey
    ? withResponseCache({
        store: env.CALENDAR_CACHE,
        key: resolvedCacheKey,
        freshnessSeconds: calendar.responseCache.freshnessSeconds,
        expirationTtlSeconds: resolvedExpirationTtl,
        label: calendar.name,
        build
      })
    : build()
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    return withCors(await handleRequest(request, env))
  }
}

async function handleRequest(request: Request, env: Env): Promise<Response> {
  const { pathname } = new URL(request.url)
  const calendar = findCalendar(pathname)

  if (!calendar) {
    return new Response('Not found', { status: 404 })
  }

  try {
    const body = await buildCalendarBody(calendar, env, request)
    return feedResponse(body, calendar.cacheTtlSeconds)
  } catch (error: unknown) {
    if (error instanceof InvalidRequestError) {
      return new Response(error.message, { status: 400, headers: NO_STORE })
    }
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
