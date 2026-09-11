import codexResets from './codex-resets/index.js'

// Every calendar the Worker serves. Each entry is
// { path, name, cacheTtlSeconds, buildEvents() }, where buildEvents resolves
// to ics event attributes and throws UpstreamError when its source fails.
export const calendars = [codexResets]

export function findCalendar(pathname) {
  return calendars.find(calendar => calendar.path === pathname)
}
