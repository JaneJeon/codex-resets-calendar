import type { CalendarPath } from '@janejeon/calendars-shared'
import type { CalendarEvent } from '@/lib/ics.js'
import codexResets from './codex-resets/index.js'
import dtsmEvents from './dtsm-events/index.js'

export interface CalendarDefinition {
  path: CalendarPath
  name: string
  cacheTtlSeconds: number
  responseCache?: {
    key: string | ((request: Request) => string | Promise<string>)
    freshnessSeconds: number
    expirationTtlSeconds?:
      | number
      | ((request: Request) => number | undefined | Promise<number | undefined>)
  }
  buildEvents(env: Env, request: Request): Promise<CalendarEvent[]>
}

// Every calendar the Worker serves. Each entry is
// { path, name, cacheTtlSeconds, responseCache?, buildEvents() }, where
// buildEvents always resolves to ics event attributes and throws UpstreamError
// when its source fails. responseCache declaratively opts the serialized
// calendar into retained-response caching; its key can vary by request when a
// calendar exposes multiple views at one path.
export const calendars: CalendarDefinition[] = [codexResets, dtsmEvents]

export function findCalendar(pathname: string): CalendarDefinition | undefined {
  return calendars.find(calendar => calendar.path === pathname)
}
