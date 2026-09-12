import { addDays as addDateDays } from 'date-fns'
import { fromZonedTime } from 'date-fns-tz'
import { decodeHTML } from 'entities'
import { convert } from 'html-to-text'
import { isValidURL } from 'ics'
import type { CalendarEvent } from '@/lib/ics.js'
import type { StoredEvent } from './repository.js'

const DOMAIN = 'cal.janejeon.dev'
const TIME_ZONE = 'America/Los_Angeles'

type CalendarDate = [number, number, number]

export function decodeEntities(value: string): string {
  return decodeHTML(value).replaceAll('\u00a0', ' ')
}

export function htmlToText(html: string): string {
  return convert(html, {
    wordwrap: false,
    selectors: [
      { selector: 'a', options: { ignoreHref: true } },
      { selector: 'img', format: 'skip' }
    ]
  }).trim()
}

function dateTuple(value: string): CalendarDate {
  const values = value.slice(0, 10).split('-').map(Number)
  return [values[0]!, values[1]!, values[2]!]
}

export function addDays(
  [year, month, day]: CalendarDate,
  days: number
): CalendarDate {
  const date = addDateDays(new Date(Date.UTC(year, month - 1, day)), days)
  return [date.getUTCFullYear(), date.getUTCMonth() + 1, date.getUTCDate()]
}

export function localDateTimeToUtc(value: string): number {
  return fromZonedTime(value, TIME_ZONE).getTime()
}

function validUrl(value: string | null): string | undefined {
  return value && isValidURL(value) ? value : undefined
}

function description(event: StoredEvent): string | undefined {
  const sections = [htmlToText(event.descriptionHtml)]
  if (event.organizers.length > 0)
    sections.push(
      `Organizers: ${event.organizers.map(decodeEntities).join(', ')}`
    )
  if (event.categoryNames.length > 0)
    sections.push(
      `Categories: ${event.categoryNames.map(decodeEntities).join(', ')}`
    )
  if (event.website) sections.push(`Website: ${event.website}`)
  const result = sections.filter(Boolean).join('\n\n')
  return result || undefined
}

function location(event: StoredEvent): string | undefined {
  if (!event.venue) return undefined
  const cityLine = [
    event.venue.city,
    event.venue.stateProvince,
    event.venue.zip
  ]
    .filter(Boolean)
    .join(' ')
  return [event.venue.name, event.venue.address, cityLine]
    .filter(Boolean)
    .map(decodeEntities)
    .join(', ')
}

function sourceStamp(value: string | null): number | undefined {
  if (!value) return undefined
  return Date.parse(`${value.replace(' ', 'T')}Z`)
}

export function buildEvents(events: StoredEvent[]): CalendarEvent[] {
  return events.map(event => {
    const stamp = sourceStamp(event.modifiedUtc ?? event.createdUtc)
    const common = {
      uid: `${event.id}@${DOMAIN}`,
      title: decodeEntities(event.title),
      description: description(event),
      location: location(event),
      categories: event.categoryNames.map(decodeEntities),
      url: validUrl(event.url),
      htmlContent: event.descriptionHtml || undefined,
      ...(stamp === undefined ? {} : { timestamp: stamp, lastModified: stamp }),
      transp: 'TRANSPARENT' as const
    }

    if (event.allDay) {
      return {
        ...common,
        start: dateTuple(event.startLocal),
        end: addDays(dateTuple(event.endLocal), 1)
      }
    }
    return {
      ...common,
      start: localDateTimeToUtc(event.startLocal),
      startInputType: 'utc' as const,
      startOutputType: 'utc' as const,
      end: localDateTimeToUtc(event.endLocal)
    }
  })
}
