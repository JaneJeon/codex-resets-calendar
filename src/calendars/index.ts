import type { CalendarEvent } from '../lib/ics.js'
import codexResets from './codex-resets/index.js'

export interface CalendarDefinition {
  path: string
  name: string
  cacheTtlSeconds: number
  buildEvents(): Promise<CalendarEvent[]>
  buildResponse?(env: Env): Promise<string>
}

// Every calendar the Worker serves. Each entry is
// { path, name, cacheTtlSeconds, buildEvents(), buildResponse?() }, where
// buildEvents resolves to ics event attributes and throws UpstreamError when
// its source fails. buildResponse is an optional calendar-owned response
// wrapper for calendars that need response-level behavior such as caching.
export const calendars: CalendarDefinition[] = [codexResets]

export function findCalendar(pathname: string): CalendarDefinition | undefined {
  return calendars.find(calendar => calendar.path === pathname)
}
