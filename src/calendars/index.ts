import type { CalendarEvent } from '../lib/ics.js'
import codexResets from './codex-resets/index.js'

export interface CalendarDefinition {
  path: string
  name: string
  cacheTtlSeconds: number
  responseCache?: {
    key: string
    freshnessSeconds: number
  }
  buildEvents(): Promise<CalendarEvent[]>
}

// Every calendar the Worker serves. Each entry is
// { path, name, cacheTtlSeconds, responseCache?, buildEvents() }, where
// buildEvents always resolves to ics event attributes and throws UpstreamError
// when its source fails. responseCache declaratively opts the serialized
// calendar into retained-response caching.
export const calendars: CalendarDefinition[] = [codexResets]

export function findCalendar(pathname: string): CalendarDefinition | undefined {
  return calendars.find(calendar => calendar.path === pathname)
}
