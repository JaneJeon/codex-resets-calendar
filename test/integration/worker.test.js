import { exports } from 'cloudflare:workers'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import resetsFixture from '../fixtures/resets.json'
import statusEmptyFixture from '../fixtures/status-empty.json'
import statusScheduledFixture from '../fixtures/status-scheduled.json'
import statusWatchFixture from '../fixtures/status-watch.json'

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
    ...init
  })
}

function mockFetch(handler) {
  vi.stubGlobal('fetch', vi.fn(handler))
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('routing', () => {
  it('redirects / to the feed path', async () => {
    mockFetch(async () => jsonResponse(resetsFixture))
    const response = await exports.default.fetch('http://example.com/', {
      redirect: 'manual'
    })
    expect(response.status).toBe(302)
    expect(response.headers.get('Location')).toContain('/codex-resets.ics')
  })

  it('returns 404 for an unknown path', async () => {
    const response = await exports.default.fetch('http://example.com/nope')
    expect(response.status).toBe(404)
  })
})

describe('the feed', () => {
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
    expect(response.headers.get('Cache-Control')).toBe(
      'public, max-age=300, s-maxage=300'
    )

    const body = await response.text()
    expect(body.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(body).toContain('CATEGORIES:regular')
    expect(body).toContain('CATEGORIES:banked')
  })

  it('serves a history-only feed when /status fails', async () => {
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
  })

  it('returns 502 when /resets returns a 5xx', async () => {
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
  })

  it('returns 502 when /resets returns 200 with an empty array', async () => {
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
          id: resetsFixture.data[0].id
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
    const uidCount = body.split(`UID:${resetsFixture.data[0].id}@`).length - 1
    expect(uidCount).toBe(1)
  })
})
