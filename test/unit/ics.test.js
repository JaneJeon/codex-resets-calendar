import { describe, expect, it } from 'vitest'
import { escapeText, foldLine, serializeCalendar } from '../../src/ics.js'

describe('escapeText', () => {
  it('escapes backslash, semicolon, comma, and newline', () => {
    expect(escapeText('a\\b;c,d\ne')).toBe('a\\\\b\\;c\\,d\\ne')
  })

  it('does not escape a colon', () => {
    expect(escapeText('https://example.com/a:b')).toBe(
      'https://example.com/a:b'
    )
  })

  it('escapes a comma inside a URL used as TEXT', () => {
    expect(escapeText('https://x.com/status/1,2')).toBe(
      'https://x.com/status/1\\,2'
    )
  })
})

describe('foldLine', () => {
  it('leaves a short line unfolded', () => {
    const line = 'SUMMARY:Codex reset'
    expect(foldLine(line)).toBe(line)
  })

  it('folds a long ASCII line at 75 octets with a leading space continuation', () => {
    const value = 'x'.repeat(120)
    const line = `SUMMARY:${value}`
    const folded = foldLine(line)
    const physicalLines = folded.split('\r\n')

    expect(physicalLines.length).toBeGreaterThan(1)
    for (const [index, physical] of physicalLines.entries()) {
      const byteLength = new TextEncoder().encode(physical).length
      expect(byteLength).toBeLessThanOrEqual(75)
      if (index > 0) expect(physical.startsWith(' ')).toBe(true)
    }

    const unfolded = physicalLines
      .map((l, i) => (i === 0 ? l : l.slice(1)))
      .join('')
    expect(unfolded).toBe(line)
  })

  it('does not split a multi-byte character across a fold boundary', () => {
    const value = 'é'.repeat(60) // 2-byte UTF-8 character, 120 bytes total
    const line = `DESCRIPTION:${value}`
    const folded = foldLine(line)
    const physicalLines = folded.split('\r\n')

    for (const physical of physicalLines) {
      const bytes = new TextEncoder().encode(physical)
      expect(bytes.length).toBeLessThanOrEqual(75)
      // Every physical line must itself be valid UTF-8 (no lone continuation byte).
      expect(() =>
        new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      ).not.toThrow()
    }

    const unfolded = physicalLines
      .map((l, i) => (i === 0 ? l : l.slice(1)))
      .join('')
    expect(unfolded).toBe(line)
  })
})

describe('serializeCalendar', () => {
  const baseEvent = {
    uid: 'abc@codex-resets-calendar.janejeon.workers.dev',
    summary: 'Codex reset',
    categories: ['regular'],
    description: 'https://x.com/a/1',
    url: 'https://x.com/a/1',
    allDay: true,
    startDate: '20260907',
    endDate: '20260908',
    dtstamp: '2026-09-07T18:00:00.000Z'
  }

  it('uses CRLF line endings throughout', () => {
    const output = serializeCalendar([baseEvent])
    expect(output.includes('\n')).toBe(true)
    expect(
      output.split('\r\n').every(line => !line.includes('\n') || line === '')
    ).toBe(true)
    expect(output.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true)
  })

  it('all-day DTEND is exactly one day after DTSTART', () => {
    const output = serializeCalendar([baseEvent])
    expect(output).toContain('DTSTART;VALUE=DATE:20260907')
    expect(output).toContain('DTEND;VALUE=DATE:20260908')
  })

  it("DTSTAMP is derived from the event's own timestamp, not the wall clock", () => {
    const first = serializeCalendar([baseEvent])
    const second = serializeCalendar([baseEvent])
    const extract = output => output.match(/DTSTAMP:(\S+)/)[1]
    expect(extract(first)).toBe(extract(second))
    expect(extract(first)).toBe('20260907T180000Z')
  })

  it('omits DESCRIPTION when the event has no URL', () => {
    const output = serializeCalendar([
      { ...baseEvent, description: undefined, url: undefined }
    ])
    expect(output).not.toContain('DESCRIPTION:')
  })

  it('does not escape the URL property', () => {
    const output = serializeCalendar([
      { ...baseEvent, url: 'https://x.com/a/1,2', description: undefined }
    ])
    expect(output).toContain('URL:https://x.com/a/1,2')
  })
})
