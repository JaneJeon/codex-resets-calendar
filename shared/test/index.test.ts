import { describe, expect, it } from 'vitest'
import {
  calendarPaths,
  calendarServiceName,
  type CalendarPath
} from '@janejeon/calendars-shared'

describe('calendar contract', () => {
  it('exports the feed paths and their string-literal type', () => {
    const path: CalendarPath = calendarPaths.codexResets

    expect(path).toBe('/codex-resets.ics')
    expect(calendarPaths.dtsmEvents).toBe('/dtsm-events.ics')
  })

  it('exports the service name used by both applications', () => {
    expect(calendarServiceName).toBe('Calendars')
  })
})
