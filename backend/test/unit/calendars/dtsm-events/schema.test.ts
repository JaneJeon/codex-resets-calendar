import { getTableConfig } from 'drizzle-orm/sqlite-core'
import { describe, expect, it } from 'vitest'
import {
  eventCategories,
  eventOrganizers,
  events
} from '@/calendars/dtsm-events/schema.js'

describe('DTSM Drizzle schema', () => {
  it('declares the event and join-table indexes and composite keys', () => {
    const eventConfig = getTableConfig(events)
    const organizerConfig = getTableConfig(eventOrganizers)
    const categoryConfig = getTableConfig(eventCategories)

    expect(eventConfig.indexes.map(index => index.config.name)).toEqual([
      'dtsm_events_end_local_idx',
      'dtsm_events_venue_idx'
    ])
    expect(organizerConfig.indexes).toHaveLength(2)
    expect(organizerConfig.primaryKeys).toHaveLength(1)
    expect(categoryConfig.indexes).toHaveLength(2)
    expect(categoryConfig.primaryKeys).toHaveLength(1)

    const references = [
      ...eventConfig.foreignKeys,
      ...organizerConfig.foreignKeys,
      ...categoryConfig.foreignKeys
    ].map(foreignKey => foreignKey.reference().foreignTable)
    expect(references).toHaveLength(5)
  })
})
