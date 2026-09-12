import { env, exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import resetsFixture from '../fixtures/resets.json'
import statusEmptyFixture from '../fixtures/status-empty.json'
import statusScheduledFixture from '../fixtures/status-scheduled.json'
import statusWatchFixture from '../fixtures/status-watch.json'
import dtsmFixture from '../fixtures/dtsm-events.json'
import { dtsmResponseCacheKey } from '@/calendars/dtsm-events/query.js'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
}

function mockFetch(handler: typeof fetch): void {
  vi.stubGlobal('fetch', vi.fn(handler))
}

beforeEach(async () => {
  vi.restoreAllMocks()
  const dtsmCache = await env.CALENDAR_CACHE.list({
    prefix: 'dtsm-events.ics'
  })
  await Promise.all([
    env.CALENDAR_CACHE.delete('codex-resets.ics'),
    ...dtsmCache.keys.map(key => env.CALENDAR_CACHE.delete(key.name))
  ])
  await env.CALENDAR_DB.batch([
    env.CALENDAR_DB.prepare('DELETE FROM dtsm_event_organizers'),
    env.CALENDAR_DB.prepare('DELETE FROM dtsm_event_categories'),
    env.CALENDAR_DB.prepare('DELETE FROM dtsm_events'),
    env.CALENDAR_DB.prepare('DELETE FROM dtsm_organizers'),
    env.CALENDAR_DB.prepare('DELETE FROM dtsm_categories'),
    env.CALENDAR_DB.prepare('DELETE FROM dtsm_venues'),
    env.CALENDAR_DB.prepare(
      `UPDATE dtsm_sync_state SET last_success_at = NULL,
       next_attempt_at = 0, lease_until = 0 WHERE calendar = 'dtsm-events'`
    )
  ])
})

describe('the Downtown San Mateo feed', () => {
  it('stores the full snapshot, filters the default feed in SQL, and renders LA wall time', async () => {
    mockFetch(async input => {
      const url = new URL(String(input))
      expect(url.searchParams.get('venue')).toBeNull()
      expect(url.searchParams.get('start_date')).toBe('2026-09-11')
      expect(url.searchParams.get('end_date')).toBeNull()
      return jsonResponse(dtsmFixture)
    })

    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics'
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600')
    const body = await response.text()
    expect(body).toContain('DTSTART:20260911T010000Z')
    expect(body).toContain('DTEND:20260911T030000Z')
    expect(body).toContain('SUMMARY:September Nights & Live Music')
    expect(body).toContain('SUMMARY:Month-long Art Walk')
    expect(body).not.toContain('Stored but not in the default feed')
    expect(body).not.toContain('very-large-image')

    const count = await env.CALENDAR_DB.prepare(
      'SELECT COUNT(*) count FROM dtsm_events'
    ).first<{
      count: number
    }>()
    expect(count?.count).toBe(3)
  })

  it('isolates canonical filter variants in KV and reuses fresh D1 state', async () => {
    mockFetch(async () => jsonResponse(dtsmFixture))
    const defaultResponse = await exports.default.fetch(
      'http://example.com/dtsm-events.ics'
    )
    const defaultBody = await defaultResponse.text()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()

    const filteredRequest = new Request(
      'http://example.com/dtsm-events.ics?venues=1201'
    )
    const filtered = await exports.default.fetch(filteredRequest)
    const filteredBody = await filtered.text()
    expect(filteredBody).toContain('September Nights')
    expect(filteredBody).not.toContain('Month-long Art Walk')
    expect(filteredBody).not.toBe(defaultBody)
    expect(fetchMock).not.toHaveBeenCalled()
    const filteredKey = await dtsmResponseCacheKey(filteredRequest)
    expect(await env.CALENDAR_CACHE.get(filteredKey)).toBe(filteredBody)
    expect(await env.CALENDAR_CACHE.get('dtsm-events.ics')).toBe(defaultBody)

    const canonicalHit = await exports.default.fetch(
      'http://example.com/dtsm-events.ics?venues=1201,1201'
    )
    expect(await canonicalHit.text()).toBe(filteredBody)
    expect(fetchMock).not.toHaveBeenCalled()

    await env.CALENDAR_CACHE.delete('dtsm-events.ics')
    const d1Hit = await exports.default.fetch(
      'http://example.com/dtsm-events.ics'
    )
    expect(await d1Hit.text()).toBe(defaultBody)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('filters a custom URL against the full catalog without filtering upstream', async () => {
    mockFetch(async input => {
      const url = new URL(String(input))
      expect(url.searchParams.get('venue')).toBeNull()
      expect(url.searchParams.get('organizers')).toBeNull()
      expect(url.searchParams.get('categories')).toBeNull()
      return jsonResponse(dtsmFixture)
    })

    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics?venues=1201,1137&categories=81'
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('Month-long Art Walk')
    expect(body).not.toContain('September Nights')
    expect(body).not.toContain('Stored but not in the default feed')
  })

  it('returns a valid empty calendar when well-formed IDs match nothing', async () => {
    mockFetch(async () => jsonResponse(dtsmFixture))

    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics?organizers=999999'
    )
    const body = await response.text()
    expect(response.status).toBe(200)
    expect(body).toContain('BEGIN:VCALENDAR')
    expect(body).not.toContain('BEGIN:VEVENT')
  })

  it('rejects malformed or unknown filter parameters without touching storage', async () => {
    const fetchMock = vi.fn(async () => jsonResponse(dtsmFixture))
    mockFetch(fetchMock)

    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics?venue=1201'
    )
    expect(response.status).toBe(400)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(await response.text()).toContain('unknown parameter venue')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes from today instead of backfilling or skipping an unsaved gap', async () => {
    mockFetch(async () => jsonResponse(dtsmFixture))
    await exports.default.fetch('http://example.com/dtsm-events.ics')
    await env.CALENDAR_CACHE.delete('dtsm-events.ics')
    await env.CALENDAR_DB.prepare(
      "UPDATE dtsm_sync_state SET next_attempt_at = 0 WHERE calendar = 'dtsm-events'"
    ).run()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()

    await exports.default.fetch('http://example.com/dtsm-events.ics')
    const url = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(url.searchParams.get('start_date')).toBe('2026-09-11')
  })

  it('revisits an event that is currently ongoing', async () => {
    const ongoing = structuredClone(dtsmFixture)
    ongoing.events[0]!.start_date = '2026-09-01 00:00:00'
    ongoing.events[0]!.end_date = '2026-09-30 23:59:59'
    mockFetch(async () => jsonResponse(ongoing))
    await exports.default.fetch('http://example.com/dtsm-events.ics')
    await env.CALENDAR_CACHE.delete('dtsm-events.ics')
    await env.CALENDAR_DB.prepare(
      "UPDATE dtsm_sync_state SET next_attempt_at = 0 WHERE calendar = 'dtsm-events'"
    ).run()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    await exports.default.fetch('http://example.com/dtsm-events.ics')
    expect(
      new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get(
        'start_date'
      )
    ).toBe('2026-09-01')
  })

  it('serves filter-matching stored rows and records a full-day backoff after refresh failure', async () => {
    mockFetch(async () => jsonResponse(dtsmFixture))
    await exports.default.fetch('http://example.com/dtsm-events.ics')
    await env.CALENDAR_CACHE.delete('dtsm-events.ics')
    await env.CALENDAR_DB.prepare(
      "UPDATE dtsm_sync_state SET next_attempt_at = 0 WHERE calendar = 'dtsm-events'"
    ).run()
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async () => new Response('down', { status: 503 }))

    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics?venues=9999'
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('Stored but not in the default feed')
    expect(body).not.toContain('September Nights')
    expect(warning).toHaveBeenCalledWith(
      'DTSM events refresh failed, serving stored events',
      expect.any(Error)
    )
    const state = await env.CALENDAR_DB.prepare(
      "SELECT next_attempt_at, last_success_at FROM dtsm_sync_state WHERE calendar = 'dtsm-events'"
    ).first<{ next_attempt_at: number; last_success_at: number }>()
    expect(
      state!.next_attempt_at - state!.last_success_at
    ).toBeGreaterThanOrEqual(86_399)
  })

  it('returns 502 and backs off an hour after an initial empty snapshot', async () => {
    mockFetch(async () => jsonResponse({ events: [], total_pages: 1 }))
    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics'
    )
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    const retry = await exports.default.fetch(
      'http://example.com/dtsm-events.ics'
    )
    expect(retry.status).toBe(502)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('returns 502 when another first refresh holds the lease', async () => {
    await env.CALENDAR_DB.prepare(
      "UPDATE dtsm_sync_state SET lease_until = 9999999999 WHERE calendar = 'dtsm-events'"
    ).run()
    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics'
    )
    expect(response.status).toBe(502)
  })

  it('serves stored rows when another refresh holds the lease', async () => {
    mockFetch(async () => jsonResponse(dtsmFixture))
    await exports.default.fetch('http://example.com/dtsm-events.ics')
    await env.CALENDAR_CACHE.delete('dtsm-events.ics')
    await env.CALENDAR_DB.prepare(
      `UPDATE dtsm_sync_state SET next_attempt_at = 0, lease_until = 9999999999
       WHERE calendar = 'dtsm-events'`
    ).run()
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics'
    )
    expect(response.status).toBe(200)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('wraps an unexpected first-refresh exception as an upstream failure', async () => {
    mockFetch(async () => new Response('not json'))
    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics'
    )
    expect(response.status).toBe(502)
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('routing', () => {
  it('returns 404 at / because there is no single feed to redirect to', async () => {
    const response = await exports.default.fetch('http://example.com/')
    expect(response.status).toBe(404)
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
  })

  it('returns 404 for an unknown path', async () => {
    const response = await exports.default.fetch('http://example.com/nope')
    expect(response.status).toBe(404)
  })
})

describe('the feed', () => {
  async function seedCachedFeed(ageSeconds = 2 * 60 * 60): Promise<string> {
    const body =
      'BEGIN:VCALENDAR\r\nBEGIN:VEVENT\r\nSUMMARY:Cached feed\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n'
    await env.CALENDAR_CACHE.put('codex-resets.ics', body, {
      metadata: { cachedAt: Date.now() - ageSeconds * 1000 }
    })
    return body
  }

  it('writes a successful response to KV and serves a fresh hit without upstream requests', async () => {
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status'))
        return jsonResponse(statusEmptyFixture)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const first = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    const firstBody = await first.text()
    const cached = await env.CALENDAR_CACHE.getWithMetadata('codex-resets.ics')
    expect(cached.value).toBe(firstBody)
    expect(cached.metadata).toEqual({ cachedAt: expect.any(Number) })

    const fetchMock = vi.mocked(fetch)
    fetchMock.mockClear()
    fetchMock.mockImplementation(async () => {
      throw new Error('upstream should not be called for a fresh cache hit')
    })
    const second = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(second.status).toBe(200)
    expect(await second.text()).toBe(firstBody)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes a stale response and replaces the cached body and timestamp', async () => {
    const oldBody = await seedCachedFeed()
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status'))
        return jsonResponse(statusEmptyFixture)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    const body = await response.text()
    const cached = await env.CALENDAR_CACHE.getWithMetadata('codex-resets.ics')
    expect(body).not.toBe(oldBody)
    expect(cached.value).toBe(body)
    expect(cached.metadata).toEqual({ cachedAt: expect.any(Number) })
  })

  it.each([
    ['network failure', 'network'] as const,
    ['5xx response', '5xx'] as const,
    ['empty history', 'empty'] as const,
    ['rate limit', '429'] as const
  ])(
    'serves a stale response when refreshing upstream has a %s',
    async (_label, failure) => {
      const cachedBody = await seedCachedFeed()
      const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
      vi.spyOn(console, 'error').mockImplementation(() => {})
      mockFetch(async input => {
        const url = String(input)
        if (url.includes('/api/v1/resets')) {
          if (failure === 'network') throw new TypeError('network down')
          if (failure === 'empty') return jsonResponse({ data: [] })
          return new Response(failure === '429' ? 'slow down' : 'boom', {
            status: failure === '429' ? 429 : 503,
            headers: failure === '429' ? { 'Retry-After': '30' } : undefined
          })
        }
        throw new Error(`unexpected fetch: ${url}`)
      })

      const response = await exports.default.fetch(
        'http://example.com/codex-resets.ics'
      )
      expect(response.status).toBe(200)
      expect(await response.text()).toBe(cachedBody)
      expect(response.headers.get('Cache-Control')).toBe('public, max-age=900')
      expect(warnSpy).toHaveBeenCalledWith(
        'Codex Resets refresh failed, serving cached response',
        expect.any(Error)
      )
    }
  )

  it('does not use stale data when serialization fails', async () => {
    await seedCachedFeed()
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unserializable = {
      ...resetsFixture,
      data: [{ ...resetsFixture.data[0], reset_type: 42 }]
    }
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(unserializable)
      if (url.includes('/api/v1/status'))
        return jsonResponse(statusEmptyFixture)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(errorSpy).toHaveBeenCalledWith(
      'Codex Resets feed failed',
      expect.anything()
    )
  })

  it('returns a fresh response when KV write fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(env.CALENDAR_CACHE, 'put').mockRejectedValue(new Error('KV down'))
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status'))
        return jsonResponse(statusEmptyFixture)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith(
      'Codex Resets response cache write failed',
      expect.any(Error)
    )
  })

  it('refreshes upstream when KV read fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    vi.spyOn(env.CALENDAR_CACHE, 'getWithMetadata').mockRejectedValue(
      new Error('KV down')
    )
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status'))
        return jsonResponse(statusEmptyFixture)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(200)
    expect(warnSpy).toHaveBeenCalledWith(
      'Codex Resets response cache read failed',
      expect.any(Error)
    )
  })

  it('happy path: serves regular and banked events with a valid calendar', async () => {
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status'))
        return jsonResponse(statusEmptyFixture)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/calendar; charset=utf-8'
    )
    expect(response.headers.get('Access-Control-Allow-Origin')).toBe('*')
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=900')

    const body = await response.text()
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(body).toContain('CATEGORIES:regular')
    expect(body).toContain('CATEGORIES:banked')
  })

  it('serves a history-only feed when /status fails', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status'))
        return new Response('unavailable', { status: 503 })
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    expect(body).toContain('BEGIN:VEVENT')
    expect(warnSpy).toHaveBeenCalledWith(
      'status fetch failed, serving history-only feed',
      expect.any(Error)
    )
  })

  it('returns 502 without caching when /resets returns a 5xx', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets'))
        return new Response('boom', { status: 503 })
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
  })

  it('returns 502 when the /resets request itself fails', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(async () => {
      throw new TypeError('network down')
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(502)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(errorSpy).toHaveBeenCalledWith(
      'resets fetch failed',
      expect.any(TypeError)
    )
  })

  it('returns 500 without caching when the feed cannot be serialized', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const unserializable = {
      ...resetsFixture,
      data: [{ ...resetsFixture.data[0], reset_type: 42 }]
    }
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(unserializable)
      if (url.includes('/api/v1/status'))
        return jsonResponse(statusEmptyFixture)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(500)
    expect(response.headers.get('Cache-Control')).toBe('no-store')
    expect(errorSpy).toHaveBeenCalledWith(
      'Codex Resets feed failed',
      expect.anything()
    )
  })

  it('returns 502 when /resets returns 200 with an empty array', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) {
        return jsonResponse({
          data: [],
          pagination: { has_more: false, next_cursor: null }
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(502)
    expect(errorSpy).toHaveBeenCalledWith(
      'resets fetch failed',
      expect.any(Error)
    )
  })

  it('returns 502 and logs Retry-After when /resets returns 429', async () => {
    const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) {
        return new Response('slow down', {
          status: 429,
          headers: { 'Retry-After': '30' }
        })
      }
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(502)
    expect(errorSpy).toHaveBeenCalledWith(
      'resets rate limited',
      expect.objectContaining({ retryAfter: '30' })
    )
  })

  it('renders a scheduled reset with an instant as a timed event', async () => {
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status'))
        return jsonResponse(statusScheduledFixture)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    const body = await response.text()
    expect(body).toContain('SUMMARY:Codex Reset announced')
    expect(body).toContain('DTSTART:20260915T173000Z')
    expect(body).toContain('DTEND:20260915T183000Z')
  })

  it('renders scheduled_for: null as an all-day event', async () => {
    const nullScheduled = {
      data: {
        ...statusScheduledFixture.data,
        scheduled_reset: {
          ...statusScheduledFixture.data.scheduled_reset,
          scheduled_for: null
        }
      },
      meta: statusScheduledFixture.meta
    }
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status')) return jsonResponse(nullScheduled)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    const body = await response.text()
    expect(body).toContain('DTSTART;VALUE=DATE:20260915')
  })

  it('renders an active watch as an all-day forecast event', async () => {
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status'))
        return jsonResponse(statusWatchFixture)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    const body = await response.text()
    expect(body).toContain('CATEGORIES:forecast')
    expect(body).toContain('SUMMARY:Codex Reset forecast (elevated\\, 62%)')
  })

  it('dedupes a scheduled reset already present in history', async () => {
    const duplicate = {
      data: {
        ...statusScheduledFixture.data,
        scheduled_reset: {
          ...statusScheduledFixture.data.scheduled_reset,
          id: resetsFixture.data[0]!.id
        }
      },
      meta: statusScheduledFixture.meta
    }
    mockFetch(async input => {
      const url = String(input)
      if (url.includes('/api/v1/resets')) return jsonResponse(resetsFixture)
      if (url.includes('/api/v1/status')) return jsonResponse(duplicate)
      throw new Error(`unexpected fetch: ${url}`)
    })

    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    const body = await response.text()
    const uidCount = body.split(`UID:${resetsFixture.data[0]!.id}@`).length - 1
    expect(uidCount).toBe(1)
  })
})
