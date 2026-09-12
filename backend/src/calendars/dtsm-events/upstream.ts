import { UpstreamError } from '@/errors.js'

const BASE_URL = 'https://dsma.org/wp-json/tribe/events/v1/events'
const PER_PAGE = 50
const MAX_PAGES = 50

export interface SourceEntity {
  id: number
  [key: string]: unknown
}

export interface SourceEvent extends SourceEntity {
  title: string
  description: string
  url?: string
  website?: string
  start_date: string
  end_date: string
  all_day: boolean
  status: string
  date?: string
  modified?: string
  venue?: SourceEntity
  organizer?: SourceEntity[]
  categories?: SourceEntity[]
}

interface EventsResponse {
  events: SourceEvent[]
  total_pages: number
}

export interface EventQuery {
  startDate: string
  endDate?: string
}

export async function fetchEvents(
  { startDate, endDate }: EventQuery,
  baseUrl: string = BASE_URL
): Promise<SourceEvent[]> {
  const events: SourceEvent[] = []

  for (let page = 1; page <= MAX_PAGES; page += 1) {
    const url = new URL(baseUrl)
    url.searchParams.set('start_date', startDate)
    if (endDate) url.searchParams.set('end_date', endDate)
    url.searchParams.set('per_page', String(PER_PAGE))
    url.searchParams.set('page', String(page))
    let response: Response
    try {
      response = await fetch(url)
    } catch {
      throw new UpstreamError('DTSM events request failed')
    }
    if (!response.ok) {
      throw new UpstreamError(`DTSM events returned ${response.status}`, {
        status: response.status,
        retryAfter: response.headers.get('Retry-After')
      })
    }

    const body = (await response.json()) as EventsResponse
    events.push(...body.events)
    if (page >= body.total_pages) return events
  }

  throw new UpstreamError('DTSM events exceeded the pagination limit')
}
