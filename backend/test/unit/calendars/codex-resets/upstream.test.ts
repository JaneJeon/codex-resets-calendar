import { afterEach, describe, expect, it, vi } from 'vitest'
import { UpstreamError } from '@/errors.js'
import { fetchResets, fetchStatus } from '@/calendars/codex-resets/upstream.js'

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' }
  })
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('fetchResets', () => {
  it('follows cursor pagination and preserves every result', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'first' }],
          pagination: { has_more: true, next_cursor: 'page-2' }
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          data: [{ id: 'second' }],
          pagination: { has_more: false, next_cursor: null }
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchResets('https://upstream.test')).resolves.toEqual([
      { id: 'first' },
      { id: 'second' }
    ])
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://upstream.test/api/v1/resets?limit=100'
    )
    expect(fetchMock).toHaveBeenNthCalledWith(
      2,
      'https://upstream.test/api/v1/resets?limit=100&cursor=page-2'
    )
  })

  it('stops when the upstream claims more pages without providing a cursor', async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({
        data: [{ id: 'only' }],
        pagination: { has_more: true, next_cursor: null }
      })
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(fetchResets('https://upstream.test')).resolves.toEqual([
      { id: 'only' }
    ])
    expect(fetchMock).toHaveBeenCalledOnce()
  })

  it('caps pagination at ten requests', async () => {
    let page = 0
    const fetchMock = vi.fn(async () => {
      page += 1
      return jsonResponse({
        data: [{ id: `reset-${page}` }],
        pagination: { has_more: true, next_cursor: `page-${page + 1}` }
      })
    })
    vi.stubGlobal('fetch', fetchMock)

    const resets = await fetchResets('https://upstream.test')
    expect(resets).toHaveLength(10)
    expect(fetchMock).toHaveBeenCalledTimes(10)
  })

  it('keeps rate-limit details on its typed error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        async () =>
          new Response('slow down', {
            status: 429,
            headers: { 'Retry-After': '45' }
          })
      )
    )

    await expect(fetchResets('https://upstream.test')).rejects.toMatchObject({
      name: 'UpstreamError',
      status: 429,
      retryAfter: '45'
    } satisfies Partial<UpstreamError>)
  })
})

describe('fetchStatus', () => {
  it('returns only the status fields used by the calendar', async () => {
    const scheduled = { id: 'scheduled' }
    const watch = { level: 'elevated' }
    vi.stubGlobal(
      'fetch',
      vi.fn(async () =>
        jsonResponse({
          data: { scheduled_reset: scheduled, active_watch: watch },
          ignored: 'metadata'
        })
      )
    )

    await expect(fetchStatus('https://upstream.test')).resolves.toEqual({
      scheduled_reset: scheduled,
      active_watch: watch
    })
  })

  it('turns a failed response into a typed upstream error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('unavailable', { status: 503 }))
    )

    await expect(fetchStatus('https://upstream.test')).rejects.toMatchObject({
      name: 'UpstreamError',
      status: 503,
      message: 'status returned 503'
    } satisfies Partial<UpstreamError>)
  })
})
