import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'
import { serializeCalendar } from '../../src/ics.js'

const stamp = Date.parse('2026-09-07T18:00:00.000Z')

const allDayEvent = {
  uid: 'all-day@example.com',
  title: 'Codex Reset',
  categories: ['regular'],
  description: 'https://x.com/a/1,2',
  url: 'https://x.com/a/1',
  start: [2026, 9, 7],
  end: [2026, 9, 8],
  timestamp: stamp,
  lastModified: stamp,
  transp: 'TRANSPARENT'
}

const timedEvent = {
  uid: 'timed@example.com',
  title: 'Codex Reset announced',
  categories: ['scheduled'],
  start: Date.parse('2026-09-15T17:30:00.000Z'),
  startInputType: 'utc',
  startOutputType: 'utc',
  end: Date.parse('2026-09-15T18:30:00.000Z'),
  timestamp: stamp,
  lastModified: stamp,
  transp: 'TRANSPARENT'
}

const options = { name: 'Codex Resets' }

function firstEvent(output) {
  return new ICAL.Component(ICAL.parse(output)).getFirstSubcomponent('vevent')
}

describe('serializeCalendar', () => {
  it('uses CRLF line endings throughout', () => {
    const output = serializeCalendar([allDayEvent], options)
    expect(output.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
    expect(output.replaceAll('\r\n', '')).not.toMatch(/[\r\n]/)
  })

  it('names the calendar', () => {
    const output = serializeCalendar([allDayEvent], options)
    const calendar = new ICAL.Component(ICAL.parse(output))
    expect(calendar.getFirstPropertyValue('x-wr-calname')).toBe('Codex Resets')
  })

  it('renders an all-day event as DATE values with an exclusive DTEND', () => {
    const output = serializeCalendar([allDayEvent], options)
    expect(output).toContain('DTSTART;VALUE=DATE:20260907')
    expect(output).toContain('DTEND;VALUE=DATE:20260908')

    const event = firstEvent(output)
    expect(event.getFirstProperty('dtstart').type).toBe('date')
    expect(event.getFirstPropertyValue('dtstart').toString()).toBe('2026-09-07')
    expect(event.getFirstPropertyValue('dtend').toString()).toBe('2026-09-08')
  })

  it('renders a timed event in UTC', () => {
    const output = serializeCalendar([timedEvent], options)
    expect(output).toContain('DTSTART:20260915T173000Z')
    expect(output).toContain('DTEND:20260915T183000Z')
  })

  it('carries SUMMARY, CATEGORIES, TRANSP, URL, and an escaped DESCRIPTION', () => {
    const output = serializeCalendar([allDayEvent], options)
    expect(output).toContain('DESCRIPTION:https://x.com/a/1\\,2')

    const event = firstEvent(output)
    expect(event.getFirstPropertyValue('summary')).toBe('Codex Reset')
    expect(event.getFirstPropertyValue('categories')).toBe('regular')
    expect(event.getFirstPropertyValue('transp')).toBe('TRANSPARENT')
    expect(event.getFirstPropertyValue('url')).toBe('https://x.com/a/1')
    expect(event.getFirstPropertyValue('description')).toBe(
      'https://x.com/a/1,2'
    )
  })

  it("DTSTAMP comes from the event's own timestamp, not the wall clock", () => {
    const first = serializeCalendar([allDayEvent], options)
    const second = serializeCalendar([allDayEvent], options)
    expect(first).toBe(second)
    expect(first).toContain('DTSTAMP:20260907T180000Z')
  })

  it('throws when the library rejects an event', () => {
    expect(() =>
      serializeCalendar([{ ...allDayEvent, url: 'not a url' }], options)
    ).toThrow()
  })
})
