import { createEvents } from 'ics'

const PRODUCT_ID = '-//janejeon//codex-resets-calendar//EN'

export function serializeCalendar(events, { name }) {
  const { error, value } = createEvents(events, {
    productId: PRODUCT_ID,
    method: 'PUBLISH',
    calName: name
  })
  if (error) throw error
  return value
}
