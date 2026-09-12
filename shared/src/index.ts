export const calendarPaths = {
  codexResets: '/codex-resets.ics',
  dtsmEvents: '/dtsm-events.ics'
} as const

export type CalendarPath = (typeof calendarPaths)[keyof typeof calendarPaths]

export const dtsmEventFilterParams = {
  venues: 'venues',
  organizers: 'organizers',
  categories: 'categories'
} as const

export type DtsmEventFilterParam =
  (typeof dtsmEventFilterParams)[keyof typeof dtsmEventFilterParams]

export const calendarServiceName = 'Calendars'
