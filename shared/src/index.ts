export const calendarPaths = {
  codexResets: '/codex-resets.ics',
  dtsmEvents: '/dtsm-events.ics'
} as const

export type CalendarPath = (typeof calendarPaths)[keyof typeof calendarPaths]

export const calendarServiceName = 'Calendars'
