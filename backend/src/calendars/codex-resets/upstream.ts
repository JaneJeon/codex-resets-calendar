import { UpstreamError } from '@/errors.js'

const BASE_URL = 'https://codex-resets.com'
const MAX_PAGES = 10

export type ResetType = 'regular' | 'banked'

export interface Source {
  type?: string
  author?: string
  url?: unknown
}

export interface Reset {
  id: string
  reset_type: ResetType
  announced_at: string
  text?: string
  source?: Source
}

export interface ScheduledReset {
  id: string
  status: string
  reset_type: ResetType
  announced_at: string
  scheduled_for: string | null
  text?: string
  source?: Source
}

export interface ActiveWatch {
  level: string
  reset_chance_percent?: number | null
  forecast_window?: string
  observed_at: string
  expires_at: string
  text?: string
  source?: Source
}

export interface ResetsResponse {
  data: Reset[]
  pagination?: {
    has_more?: boolean
    next_cursor?: string | null
  }
}

export interface StatusResponse {
  data: {
    scheduled_reset: ScheduledReset | null
    active_watch: ActiveWatch | null
  }
}

export interface Status {
  scheduled_reset?: ScheduledReset | null
  active_watch?: ActiveWatch | null
}

export async function fetchResets(
  baseUrl: string = BASE_URL
): Promise<Reset[]> {
  const results: Reset[] = []
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

    const body = (await response.json()) as ResetsResponse
    results.push(...body.data)

    if (!body.pagination?.has_more || !body.pagination?.next_cursor) break
    cursor = body.pagination.next_cursor
  }

  if (results.length === 0) {
    throw new UpstreamError('resets returned no history')
  }

  return results
}

export async function fetchStatus(baseUrl: string = BASE_URL): Promise<Status> {
  const url = new URL('/api/v1/status', baseUrl)
  const response = await fetch(url.toString())

  if (!response.ok) {
    throw new UpstreamError(`status returned ${response.status}`, {
      status: response.status
    })
  }

  const body = (await response.json()) as StatusResponse
  return {
    scheduled_reset: body.data.scheduled_reset,
    active_watch: body.data.active_watch
  }
}
