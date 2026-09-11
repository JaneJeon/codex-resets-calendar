import { describe, expect, it } from 'vitest'
import {
  addDays,
  buildEvents,
  decodeEntities,
  htmlToText,
  localDateTimeToUtc
} from '../../../../src/calendars/dtsm-events/events.js'
import type { StoredEvent } from '../../../../src/calendars/dtsm-events/repository.js'

const timed: StoredEvent = {
  id: 6228,
  title: 'September Nights &#038; Music',
  descriptionHtml:
    '<p>Hello <strong>San Mateo</strong>.</p><p>Everyone&#8217;s welcome.</p>',
  url: 'https://dsma.org/event/music/',
  website: 'https://example.com/tickets',
  startLocal: '2026-09-10 18:00:00',
  endLocal: '2026-09-10 20:00:00',
  allDay: false,
  createdUtc: '2026-08-01 17:00:00',
  modifiedUtc: '2026-09-01 19:30:00',
  venue: {
    name: 'North B Street',
    address: '200 N B St',
    city: 'San Mateo',
    stateProvince: 'CA',
    zip: '94401'
  },
  organizers: ['DSMA', 'City'],
  categoryNames: ['Music &#038; Nightlife']
}

describe('DTSM event conversion', () => {
  it('decodes named, decimal, and hexadecimal HTML entities', () => {
    expect(
      decodeEntities('&amp; &apos; &quot; &lt; &gt; &nbsp; &#8217; &#x26;')
    ).toBe(`& ' " < >   ’ &`)
  })

  it('turns HTML blocks into readable plain text', () => {
    expect(htmlToText('<div>One<br>Two</div><ul><li>Three</li></ul>')).toBe(
      'One\nTwo\n * Three'
    )
  })

  it('uses Los Angeles wall time regardless of upstream timezone metadata', () => {
    expect(
      new Date(localDateTimeToUtc('2026-09-10 18:00:00')).toISOString()
    ).toBe('2026-09-11T01:00:00.000Z')
    expect(
      new Date(localDateTimeToUtc('2026-12-10 18:00:00')).toISOString()
    ).toBe('2026-12-11T02:00:00.000Z')
    expect(new Date(localDateTimeToUtc('2026-09-10')).toISOString()).toBe(
      '2026-09-10T07:00:00.000Z'
    )
  })

  it('builds a detailed timed event from normalized records', () => {
    const [event] = buildEvents([timed])
    expect(event).toMatchObject({
      uid: '6228@cal.janejeon.dev',
      title: 'September Nights & Music',
      start: Date.parse('2026-09-11T01:00:00Z'),
      end: Date.parse('2026-09-11T03:00:00Z'),
      location: 'North B Street, 200 N B St, San Mateo CA 94401',
      categories: ['Music & Nightlife'],
      timestamp: Date.parse('2026-09-01T19:30:00Z'),
      transp: 'TRANSPARENT'
    })
    expect(event!.description).toContain('Organizers: DSMA, City')
    expect(event!.description).toContain('Website: https://example.com/tickets')
  })

  it('makes the inclusive upstream all-day end date exclusive for ICS', () => {
    const [event] = buildEvents([
      {
        ...timed,
        id: 6300,
        startLocal: '2026-10-01 00:00:00',
        endLocal: '2026-10-31 23:59:59',
        allDay: true
      }
    ])
    expect(event!.start).toEqual([2026, 10, 1])
    expect(event!.end).toEqual([2026, 11, 1])
    expect(addDays([2024, 2, 28], 1)).toEqual([2024, 2, 29])
  })

  it('omits absent details and rejects only the invalid source URL field', () => {
    const [event] = buildEvents([
      {
        ...timed,
        descriptionHtml: '',
        url: 'not a URL',
        website: null,
        modifiedUtc: null,
        createdUtc: null,
        venue: null,
        organizers: [],
        categoryNames: []
      }
    ])
    expect(event).not.toHaveProperty('timestamp')
    expect(event!.description).toBeUndefined()
    expect(event!.location).toBeUndefined()
    expect(event!.url).toBeUndefined()
    expect(event!.htmlContent).toBeUndefined()
  })

  it('falls back to the creation stamp when no modification stamp exists', () => {
    const [event] = buildEvents([{ ...timed, modifiedUtc: null }])
    expect(event!.timestamp).toBe(Date.parse('2026-08-01T17:00:00Z'))
  })
})
