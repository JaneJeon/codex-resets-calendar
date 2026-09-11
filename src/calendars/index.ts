import type { CalendarEvent } from '../ics.js'
import codexResets from './codex-resets/index.js'

export interface CalendarDefinition {
  path: string
  name: string
  cacheTtlSeconds: number
  buildEvents(): Promise<CalendarEvent[]>
}

// Every calendar the Worker serves. Each entry is
// { path, name, cacheTtlSeconds, buildEvents() }, where buildEvents resolves
// to ics event attributes and throws UpstreamError when its source fails.
export const calendars: CalendarDefinition[] = [codexResets]

export function findCalendar(pathname: string): CalendarDefinition | undefined {
  return calendars.find(calendar => calendar.path === pathname)
}
