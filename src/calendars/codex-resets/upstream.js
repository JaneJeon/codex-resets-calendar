import { UpstreamError } from '../../errors.js'

const BASE_URL = 'https://codex-resets.com'
const MAX_PAGES = 10

export async function fetchResets(baseUrl = BASE_URL) {
  const results = []
  let cursor

  for (let page = 0; page < MAX_PAGES; page += 1) {
    const url = new URL('/api/v1/resets', baseUrl)
    url.searchParams.set('limit', '100')
    if (cursor) url.searchParams.set('cursor', cursor)

    const response = await fetch(url.toString())

    if (response.status === 429) {
      throw new UpstreamError('resets rate limited', {
        status: 429,
        retryAfter: response.headers.get('Retry-After')
      })
    }
    if (!response.ok) {
      throw new UpstreamError(`resets returned ${response.status}`, {
        status: response.status
      })
    }

    const body = await response.json()
    results.push(...body.data)

    if (!body.pagination?.has_more || !body.pagination?.next_cursor) break
    cursor = body.pagination.next_cursor
  }

  if (results.length === 0) {
    throw new UpstreamError('resets returned no history')
  }

  return results
}

export async function fetchStatus(baseUrl = BASE_URL) {
  const url = new URL('/api/v1/status', baseUrl)
  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new UpstreamError(`status returned ${response.status}`, {
      status: response.status
    })
  }

  const body = await response.json()
  return {
    scheduled_reset: body.data.scheduled_reset,
    active_watch: body.data.active_watch
  }
}
