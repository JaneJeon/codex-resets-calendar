import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text
} from 'drizzle-orm/sqlite-core'

export const venues = sqliteTable('dtsm_venues', {
  id: integer().primaryKey(),
  name: text().notNull(),
  address: text().notNull(),
  city: text().notNull(),
  stateProvince: text('state_province').notNull(),
  country: text().notNull(),
  zip: text().notNull(),
  url: text(),
  modifiedUtc: text('modified_utc')
})

export const organizers = sqliteTable('dtsm_organizers', {
  id: integer().primaryKey(),
  name: text().notNull(),
  email: text().notNull(),
  phone: text().notNull(),
  website: text(),
  url: text(),
  modifiedUtc: text('modified_utc')
})

export const categories = sqliteTable('dtsm_categories', {
  id: integer().primaryKey(),
  name: text().notNull(),
  slug: text().notNull(),
  description: text().notNull()
})

export const events = sqliteTable(
  'dtsm_events',
  {
    id: integer().primaryKey(),
    title: text().notNull(),
    descriptionHtml: text('description_html').notNull(),
    url: text(),
    website: text(),
    startLocal: text('start_local').notNull(),
    endLocal: text('end_local').notNull(),
    allDay: integer('all_day', { mode: 'boolean' }).notNull(),
    status: text().notNull(),
    venueId: integer('venue_id').references(() => venues.id),
    createdUtc: text('created_utc'),
    modifiedUtc: text('modified_utc'),
    withdrawnAt: integer('withdrawn_at')
  },
  table => [
    index('dtsm_events_end_local_idx').on(table.endLocal),
    index('dtsm_events_venue_idx').on(table.venueId)
  ]
)

export const eventOrganizers = sqliteTable(
  'dtsm_event_organizers',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    organizerId: integer('organizer_id')
      .notNull()
      .references(() => organizers.id),
    position: integer().notNull()
  },
  table => [
    primaryKey({ columns: [table.eventId, table.organizerId] }),
    index('dtsm_event_organizers_event_idx').on(table.eventId),
    index('dtsm_event_organizers_organizer_idx').on(table.organizerId)
  ]
)

export const eventCategories = sqliteTable(
  'dtsm_event_categories',
  {
    eventId: integer('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    categoryId: integer('category_id')
      .notNull()
      .references(() => categories.id),
    position: integer().notNull()
  },
  table => [
    primaryKey({ columns: [table.eventId, table.categoryId] }),
    index('dtsm_event_categories_event_idx').on(table.eventId),
    index('dtsm_event_categories_category_idx').on(table.categoryId)
  ]
)

export const syncState = sqliteTable('dtsm_sync_state', {
  calendar: text().primaryKey(),
  lastSuccessAt: integer('last_success_at'),
  nextAttemptAt: integer('next_attempt_at').notNull().default(0),
  leaseUntil: integer('lease_until').notNull().default(0)
})
