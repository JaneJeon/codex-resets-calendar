import { createEvents, type EventAttributes } from 'ics'

const PRODUCT_ID = '-//janejeon//calendars//EN'

export type CalendarEvent = EventAttributes & {
  end: EventAttributes['start']
  timestamp?: number
}

export interface CalendarSerializationOptions {
  name: string
}

function foldLine(line: string): string {
  const encoder = new TextEncoder()
  const parts: string[] = []
  let part = ''
  let bytes = 0

  for (const character of line) {
    const characterBytes = encoder.encode(character).byteLength
    const limit = parts.length === 0 ? 75 : 74
    if (bytes + characterBytes > limit) {
      parts.push(part)
      part = character
      bytes = characterBytes
    } else {
      part += character
      bytes += characterBytes
    }
  }
  parts.push(part)
  return parts.join('\r\n ')
}

export function foldCalendar(value: string): string {
  const unfolded = value.replace(/\r\n[ \t]/g, '')
  return unfolded.split('\r\n').map(foldLine).join('\r\n')
}

export function serializeCalendar(
  events: CalendarEvent[],
  { name }: CalendarSerializationOptions
): string {
  const { error, value } = createEvents(events, {
    productId: PRODUCT_ID,
    method: 'PUBLISH',
    calName: name
  })
  if (error) throw error
  return foldCalendar(value as string)
}
