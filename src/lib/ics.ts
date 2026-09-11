import { createEvents, type EventAttributes } from 'ics'

const PRODUCT_ID = '-//janejeon//calendars//EN'

export type CalendarEvent = EventAttributes & {
  end: EventAttributes['start']
  timestamp?: number
}

export interface CalendarSerializationOptions {
  name: string
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
  return value as string
}
