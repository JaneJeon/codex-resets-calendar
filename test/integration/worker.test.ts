import { env, exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import resetsFixture from '../fixtures/resets.json'
import statusEmptyFixture from '../fixtures/status-empty.json'
import statusScheduledFixture from '../fixtures/status-scheduled.json'
import statusWatchFixture from '../fixtures/status-watch.json'

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
  await env.CALENDAR_CACHE.delete('codex-resets.ics')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('routing', () => {
  it('returns 404 at / because there is no single feed to redirect to', async () => {
    const response = await exports.default.fetch('http://example.com/')
    expect(response.status).toBe(404)
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
