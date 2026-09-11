import {
  and,
  asc,
  eq,
  exists,
  getTableColumns,
  gte,
  inArray,
  isNull,
  lte,
  min,
  sql
} from 'drizzle-orm'
import type { BatchItem } from 'drizzle-orm/batch'
import { drizzle, type DrizzleD1Database } from 'drizzle-orm/d1'
import type { AnySQLiteTable } from 'drizzle-orm/sqlite-core'
import {
  categories,
  eventCategories,
  eventOrganizers,
  events,
  organizers,
  syncState,
  venues
} from './schema.js'
import type { SourceEntity, SourceEvent } from './upstream.js'

const CALENDAR = 'dtsm-events'
const DAY_SECONDS = 24 * 60 * 60
const INITIAL_FAILURE_SECONDS = 60 * 60
const LEASE_SECONDS = 5 * 60
const CHUNK_SIZE = 50

export interface StoredVenue {
  name: string
  address: string
  city: string
  stateProvince: string
  zip: string
}

export interface StoredEvent {
  id: number
  title: string
  descriptionHtml: string
  url: string | null
  website: string | null
  startLocal: string
  endLocal: string
  allDay: boolean
  createdUtc: string | null
  modifiedUtc: string | null
  venue: StoredVenue | null
  organizers: string[]
  categoryNames: string[]
}

export interface EventFilter {
  venueIds?: number[]
  organizerIds?: number[]
  categoryIds?: number[]
}

interface SyncState {
  last_success_at: number | null
  next_attempt_at: number
  lease_until: number
}

interface NormalizedSnapshot {
  events: Record<string, unknown>[]
  venues: Record<string, unknown>[]
  organizers: Record<string, unknown>[]
  categories: Record<string, unknown>[]
  eventOrganizers: Record<string, unknown>[]
  eventCategories: Record<string, unknown>[]
}

function text(entity: SourceEntity, key: string): string {
  const value = entity[key]
  return typeof value === 'string' ? value : ''
}

function nullableText(entity: SourceEntity, key: string): string | null {
  const value = text(entity, key)
  return value || null
}

function optionalText(value: string | undefined): string | null {
  return value || null
}

function normalizeVenue(venue: SourceEntity): Record<string, unknown> {
  return {
    id: venue.id,
    name: text(venue, 'venue'),
    address: text(venue, 'address'),
    city: text(venue, 'city'),
    state_province: text(venue, 'stateprovince'),
    country: text(venue, 'country'),
    zip: text(venue, 'zip'),
    url: nullableText(venue, 'url'),
    modified_utc: nullableText(venue, 'modified')
  }
}

function normalizeOrganizer(organizer: SourceEntity): Record<string, unknown> {
  return {
    id: organizer.id,
    name: text(organizer, 'organizer'),
    email: text(organizer, 'email'),
    phone: text(organizer, 'phone'),
    website: nullableText(organizer, 'website'),
    url: nullableText(organizer, 'url'),
    modified_utc: nullableText(organizer, 'modified')
  }
}

function normalizeCategory(category: SourceEntity): Record<string, unknown> {
  return {
    id: category.id,
    name: text(category, 'name'),
    slug: text(category, 'slug'),
    description: text(category, 'description')
  }
}

function normalizeEvent(event: SourceEvent): Record<string, unknown> {
  return {
    id: event.id,
    title: event.title,
    description_html: event.description,
    url: optionalText(event.url),
    website: optionalText(event.website),
    start_local: event.start_date,
    end_local: event.end_date,
    all_day: event.all_day ? 1 : 0,
    status: event.status,
    venue_id: event.venue ? event.venue.id : null,
    created_utc: optionalText(event.date),
    modified_utc: optionalText(event.modified)
  }
}

function collectEntities(
  events: SourceEvent[],
  select: (event: SourceEvent) => SourceEntity[],
  normalize: (entity: SourceEntity) => Record<string, unknown>
): Record<string, unknown>[] {
  const byId = new Map<number, Record<string, unknown>>()
  for (const event of events)
    for (const entity of select(event)) byId.set(entity.id, normalize(entity))
  return [...byId.values()]
}

function collectRelations(
  events: SourceEvent[],
  select: (event: SourceEvent) => SourceEntity[],
  foreignKey: 'organizer_id' | 'category_id'
): Record<string, unknown>[] {
  return events.flatMap(event =>
    select(event).map((entity, position) => ({
      event_id: event.id,
      [foreignKey]: entity.id,
      position
    }))
  )
}

export function normalizeSnapshot(
  sourceEvents: SourceEvent[]
): NormalizedSnapshot {
  const venues = collectEntities(
    sourceEvents,
    event => (event.venue ? [event.venue] : []),
    normalizeVenue
  )
  const organizers = collectEntities(
    sourceEvents,
    event => event.organizer ?? [],
    normalizeOrganizer
  )
  const categories = collectEntities(
    sourceEvents,
    event => event.categories ?? [],
    normalizeCategory
  )
  return {
    events: sourceEvents.map(normalizeEvent),
    venues,
    organizers,
    categories,
    eventOrganizers: collectRelations(
      sourceEvents,
      event => event.organizer ?? [],
      'organizer_id'
    ),
    eventCategories: collectRelations(
      sourceEvents,
      event => event.categories ?? [],
      'category_id'
    )
  }
}

function chunks<T>(values: T[]): T[][] {
  const result: T[][] = []
  for (let index = 0; index < values.length; index += CHUNK_SIZE)
    result.push(values.slice(index, index + CHUNK_SIZE))
  return result
}

interface BulkTable {
  schema: AnySQLiteTable
  conflictColumns: string[]
  resetColumns?: string[]
}

const BULK_TABLES = {
  venues: {
    schema: venues,
    conflictColumns: ['id']
  },
  organizers: {
    schema: organizers,
    conflictColumns: ['id']
  },
  categories: {
    schema: categories,
    conflictColumns: ['id']
  },
  events: {
    schema: events,
    conflictColumns: ['id'],
    resetColumns: ['withdrawn_at']
  },
  eventOrganizers: {
    schema: eventOrganizers,
    conflictColumns: ['event_id', 'organizer_id']
  },
  eventCategories: {
    schema: eventCategories,
    conflictColumns: ['event_id', 'category_id']
  }
} satisfies Record<keyof NormalizedSnapshot, BulkTable>

function bulkUpsertSelect(table: BulkTable, values: unknown[]) {
  const columns = Object.values(getTableColumns(table.schema)).map(
    column => column.name
  )
  const resetColumns = table.resetColumns ?? []
  const mutable = columns.filter(
    column =>
      !table.conflictColumns.includes(column) && !resetColumns.includes(column)
  )
  const selected = columns.map(column =>
    resetColumns.includes(column)
      ? 'NULL'
      : `json_extract(value, '$.${column}')`
  )
  const assignments = [
    ...mutable.map(column => `${column}=excluded.${column}`),
    ...resetColumns.map(column => `${column}=NULL`)
  ]
  const changed = [
    ...mutable.map(column => `${column} IS NOT excluded.${column}`),
    ...resetColumns.map(column => `${column} IS NOT NULL`)
  ]
  return sql
    .raw(`SELECT ${selected.join(',')} FROM json_each(`)
    .append(sql`${JSON.stringify(values)}`)
    .append(
      sql.raw(`) WHERE TRUE
    ON CONFLICT(${table.conflictColumns.join(',')}) DO UPDATE SET ${assignments.join(',')}
    WHERE ${changed.join(' OR ')}`)
    )
}

function upsertStatements(
  db: DrizzleD1Database,
  snapshot: NormalizedSnapshot
): BatchItem<'sqlite'>[] {
  const statements: BatchItem<'sqlite'>[] = []
  for (const key of Object.keys(BULK_TABLES) as (keyof NormalizedSnapshot)[])
    for (const values of chunks(snapshot[key]))
      statements.push(
        db
          .insert(BULK_TABLES[key].schema)
          .select(bulkUpsertSelect(BULK_TABLES[key], values))
      )
  return statements
}

export async function persistSnapshot(
  db: D1Database,
  sourceEvents: SourceEvent[],
  nowSeconds: number,
  currentLocal: string
): Promise<void> {
  const orm = drizzle(db)
  const snapshot = normalizeSnapshot(sourceEvents)
  const eventIds = sourceEvents.map(event => event.id)
  const statements = upsertStatements(orm, snapshot)
  statements.push(
    orm.delete(eventOrganizers).where(
      and(
        sql`${eventOrganizers.eventId} IN (SELECT value FROM json_each(${JSON.stringify(eventIds)}))`,
        sql`json_array(${eventOrganizers.eventId}, ${eventOrganizers.organizerId}) NOT IN
             (SELECT json_array(json_extract(value, '$.event_id'), json_extract(value, '$.organizer_id'))
                FROM json_each(${JSON.stringify(snapshot.eventOrganizers)}))`
      )
    ),
    orm.delete(eventCategories).where(
      and(
        sql`${eventCategories.eventId} IN (SELECT value FROM json_each(${JSON.stringify(eventIds)}))`,
        sql`json_array(${eventCategories.eventId}, ${eventCategories.categoryId}) NOT IN
             (SELECT json_array(json_extract(value, '$.event_id'), json_extract(value, '$.category_id'))
                FROM json_each(${JSON.stringify(snapshot.eventCategories)}))`
      )
    ),
    orm
      .update(events)
      .set({ withdrawnAt: nowSeconds })
      .where(
        and(
          isNull(events.withdrawnAt),
          gte(events.endLocal, currentLocal),
          sql`${events.id} NOT IN (SELECT value FROM json_each(${JSON.stringify(eventIds)}))`
        )
      ),
    orm
      .update(syncState)
      .set({
        lastSuccessAt: nowSeconds,
        nextAttemptAt: nowSeconds + DAY_SECONDS,
        leaseUntil: 0
      })
      .where(eq(syncState.calendar, CALENDAR))
  )
  await orm.batch(statements as [BatchItem<'sqlite'>, ...BatchItem<'sqlite'>[]])
}

export async function readEvents(
  db: D1Database,
  filter: EventFilter = {}
): Promise<StoredEvent[]> {
  if (
    filter.venueIds?.length === 0 ||
    filter.organizerIds?.length === 0 ||
    filter.categoryIds?.length === 0
  )
    return []

  const orm = drizzle(db)
  const conditions = [isNull(events.withdrawnAt)]
  if (filter.venueIds) conditions.push(inArray(events.venueId, filter.venueIds))
  if (filter.organizerIds)
    conditions.push(
      exists(
        orm
          .select({ one: sql`1` })
          .from(eventOrganizers)
          .where(
            and(
              eq(eventOrganizers.eventId, events.id),
              inArray(eventOrganizers.organizerId, filter.organizerIds)
            )
          )
      )
    )
  if (filter.categoryIds)
    conditions.push(
      exists(
        orm
          .select({ one: sql`1` })
          .from(eventCategories)
          .where(
            and(
              eq(eventCategories.eventId, events.id),
              inArray(eventCategories.categoryId, filter.categoryIds)
            )
          )
      )
    )

  const rows = await orm
    .select({
      event: events,
      venue: {
        id: venues.id,
        name: venues.name,
        address: venues.address,
        city: venues.city,
        stateProvince: venues.stateProvince,
        zip: venues.zip
      }
    })
    .from(events)
    .leftJoin(venues, eq(venues.id, events.venueId))
    .where(and(...conditions))
    .orderBy(asc(events.startLocal), asc(events.endLocal), asc(events.id))
  const ids = rows.map(row => row.event.id)
  if (ids.length === 0) return []
  const [organizerRows, categoryRows] = await Promise.all([
    orm
      .select({ eventId: eventOrganizers.eventId, name: organizers.name })
      .from(eventOrganizers)
      .innerJoin(organizers, eq(organizers.id, eventOrganizers.organizerId))
      .where(
        sql`${eventOrganizers.eventId} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`
      )
      .orderBy(asc(eventOrganizers.eventId), asc(eventOrganizers.position)),
    orm
      .select({ eventId: eventCategories.eventId, name: categories.name })
      .from(eventCategories)
      .innerJoin(categories, eq(categories.id, eventCategories.categoryId))
      .where(
        sql`${eventCategories.eventId} IN (SELECT value FROM json_each(${JSON.stringify(ids)}))`
      )
      .orderBy(asc(eventCategories.eventId), asc(eventCategories.position))
  ])
  const names = (
    relationRows: { eventId: number; name: string }[],
    eventId: number
  ) => relationRows.filter(row => row.eventId === eventId).map(row => row.name)
  return rows.map(({ event, venue }) => ({
    id: event.id,
    title: event.title,
    descriptionHtml: event.descriptionHtml,
    url: event.url,
    website: event.website,
    startLocal: event.startLocal,
    endLocal: event.endLocal,
    allDay: event.allDay,
    createdUtc: event.createdUtc,
    modifiedUtc: event.modifiedUtc,
    venue,
    organizers: names(organizerRows, event.id),
    categoryNames: names(categoryRows, event.id)
  }))
}

export async function readOngoingStart(
  db: D1Database,
  currentLocal: string
): Promise<string | null> {
  const row = await drizzle(db)
    .select({ startLocal: min(events.startLocal) })
    .from(events)
    .where(
      and(
        isNull(events.withdrawnAt),
        lte(events.startLocal, currentLocal),
        gte(events.endLocal, currentLocal)
      )
    )
    .get()
  return row?.startLocal ?? null
}

export async function readSyncState(db: D1Database): Promise<SyncState> {
  const state = await drizzle(db)
    .select()
    .from(syncState)
    .where(eq(syncState.calendar, CALENDAR))
    .get()
  if (!state) throw new Error('DTSM sync state is missing')
  return {
    last_success_at: state.lastSuccessAt,
    next_attempt_at: state.nextAttemptAt,
    lease_until: state.leaseUntil
  }
}

export async function acquireLease(
  db: D1Database,
  nowSeconds: number
): Promise<boolean> {
  const acquired = await drizzle(db)
    .update(syncState)
    .set({ leaseUntil: nowSeconds + LEASE_SECONDS })
    .where(
      and(
        eq(syncState.calendar, CALENDAR),
        lte(syncState.nextAttemptAt, nowSeconds),
        lte(syncState.leaseUntil, nowSeconds)
      )
    )
    .returning({ calendar: syncState.calendar })
  return acquired.length === 1
}

export async function recordFailure(
  db: D1Database,
  nowSeconds: number,
  hasStoredEvents: boolean
): Promise<void> {
  await drizzle(db)
    .update(syncState)
    .set({
      nextAttemptAt:
        nowSeconds + (hasStoredEvents ? DAY_SECONDS : INITIAL_FAILURE_SECONDS),
      leaseUntil: 0
    })
    .where(eq(syncState.calendar, CALENDAR))
}
