import {
  dtsmEventFilterParams,
  type DtsmEventFilterParam
} from '@janejeon/calendars-shared'
import { InvalidRequestError } from '@/errors.js'
import type { EventFilter } from './repository.js'

export const DEFAULT_DTSM_VENUE_IDS = [
  1201, 1249, 1260, 1328, 3999, 1137
] as const
export const CUSTOM_DTSM_CACHE_RETENTION_SECONDS = 30 * 24 * 60 * 60

const PARAMETER_ORDER = [
  dtsmEventFilterParams.venues,
  dtsmEventFilterParams.organizers,
  dtsmEventFilterParams.categories
] satisfies DtsmEventFilterParam[]
const PARAMETER_NAMES = new Set<string>(PARAMETER_ORDER)

export interface ParsedDtsmEventFilter {
  filter: EventFilter
  canonicalQuery: string
}

function invalid(message: string): never {
  throw new InvalidRequestError(`Invalid DTSM event filters: ${message}`)
}

function parseIds(
  searchParams: URLSearchParams,
  name: DtsmEventFilterParam
): number[] | undefined {
  const values = searchParams.getAll(name)
  if (values.length === 0) return undefined
  if (values.length > 1) invalid(`${name} may appear only once`)

  const tokens = values[0]!.split(',').map(value => value.trim())
  if (tokens.some(value => !/^[1-9]\d*$/.test(value)))
    invalid(`${name} must be a comma-separated list of positive integers`)

  const ids = tokens.map(Number)
  if (ids.some(value => !Number.isSafeInteger(value)))
    invalid(`${name} contains an integer outside the safe range`)

  return [...new Set(ids)].sort((left, right) => left - right)
}

export function parseDtsmEventFilter(
  searchParams: URLSearchParams
): ParsedDtsmEventFilter {
  for (const name of searchParams.keys())
    if (!PARAMETER_NAMES.has(name)) invalid(`unknown parameter ${name}`)

  if (searchParams.size === 0) {
    return {
      filter: { venueIds: [...DEFAULT_DTSM_VENUE_IDS] },
      canonicalQuery: ''
    }
  }

  const values = {
    venues: parseIds(searchParams, dtsmEventFilterParams.venues),
    organizers: parseIds(searchParams, dtsmEventFilterParams.organizers),
    categories: parseIds(searchParams, dtsmEventFilterParams.categories)
  }
  const filter: EventFilter = {
    ...(values.venues ? { venueIds: values.venues } : {}),
    ...(values.organizers ? { organizerIds: values.organizers } : {}),
    ...(values.categories ? { categoryIds: values.categories } : {})
  }
  const canonicalQuery = PARAMETER_ORDER.flatMap(name => {
    const ids = values[name]
    return ids ? [`${name}=${ids.join(',')}`] : []
  }).join('&')

  return { filter, canonicalQuery }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)]
    .map(value => value.toString(16).padStart(2, '0'))
    .join('')
}

export async function dtsmResponseCacheKey(request: Request): Promise<string> {
  const { canonicalQuery } = parseDtsmEventFilter(
    new URL(request.url).searchParams
  )
  if (!canonicalQuery) return 'dtsm-events.ics'

  const digest = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(canonicalQuery)
  )
  return `dtsm-events.ics:${hex(digest)}`
}

export function dtsmResponseCacheExpirationTtl(
  request: Request
): number | undefined {
  const { canonicalQuery } = parseDtsmEventFilter(
    new URL(request.url).searchParams
  )
  return canonicalQuery ? CUSTOM_DTSM_CACHE_RETENTION_SECONDS : undefined
}
