import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpstreamError } from '@/errors.js'
import {
  DOWNTOWN_VENUE_IDS,
  fetchEvents
} from '@/calendars/dtsm-events/upstream.js'

afterEach(() => vi.unstubAllGlobals())

function response(events: unknown[], totalPages: number): Response {
  return new Response(JSON.stringify({ events, total_pages: totalPages }))
}

describe('fetchEvents', () => {
  it('fetches every page of one unfiltered, open-ended snapshot', async () => {
    const fetchMock = vi.fn(async (input: URL | RequestInfo) => {
      const page = new URL(String(input)).searchParams.get('page')
      return response([{ id: Number(page) }], 2)
    })
    vi.stubGlobal('fetch', fetchMock)

    const events = await fetchEvents(
      { startDate: '2026-09-11' },
      'https://example.com/events'
    )

    expect(events.map(event => event.id)).toEqual([1, 2])
    expect(fetchMock).toHaveBeenCalledTimes(2)
    const firstUrl = new URL(String(fetchMock.mock.calls[0]![0]))
    expect(firstUrl.searchParams.get('per_page')).toBe('50')
    expect(firstUrl.searchParams.get('venue')).toBeNull()
    expect(firstUrl.searchParams.get('start_date')).toBe('2026-09-11')
    expect(firstUrl.searchParams.get('end_date')).toBeNull()
  })

  it('supports a source-side venue filter without making it the default', async () => {
    const fetchMock = vi.fn(async (_input: URL | RequestInfo) =>
      response([], 1)
    )
    vi.stubGlobal('fetch', fetchMock)
    await fetchEvents(
      {
        startDate: '2026-09-11',
        endDate: '2028-09-11',
        venueIds: DOWNTOWN_VENUE_IDS
      },
      'https://example.com/events'
    )
    expect(
      new URL(String(fetchMock.mock.calls[0]![0])).searchParams.get('venue')
    ).toBe(DOWNTOWN_VENUE_IDS.join(','))
  })

  it('wraps a network failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => Promise.reject(new Error('down')))
    )
    await expect(
      fetchEvents(
        { startDate: '2026-09-11', endDate: '2028-09-11' },
        'https://example.com/events'
      )
    ).rejects.toThrow('DTSM events request failed')
  })

  it('preserves status and Retry-After on an HTTP failure', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('slow down', {
            status: 429,
            headers: { 'Retry-After': '30' }
          })
      )
    )
    let error: UpstreamError | undefined
    try {
      await fetchEvents(
        { startDate: '2026-09-11', endDate: '2028-09-11' },
        'https://example.com/events'
      )
    } catch (value: unknown) {
      error = value as UpstreamError
    }
    expect(error).toBeInstanceOf(UpstreamError)
    expect(error!.status).toBe(429)
    expect(error!.retryAfter).toBe('30')
  })

  it('rejects pagination beyond the safety limit', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => response([], 51))
    )
    await expect(
      fetchEvents(
        { startDate: '2026-09-11', endDate: '2028-09-11' },
        'https://example.com/events'
      )
    ).rejects.toThrow('exceeded the pagination limit')
  })
})
