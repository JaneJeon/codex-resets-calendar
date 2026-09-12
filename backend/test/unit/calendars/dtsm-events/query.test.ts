import { describe, expect, it } from 'vitest'
import { InvalidRequestError } from '@/errors.js'
import {
  CUSTOM_DTSM_CACHE_RETENTION_SECONDS,
  DEFAULT_DTSM_VENUE_IDS,
  dtsmResponseCacheExpirationTtl,
  dtsmResponseCacheKey,
  parseDtsmEventFilter
} from '@/calendars/dtsm-events/query.js'

function parse(query = '') {
  return parseDtsmEventFilter(new URLSearchParams(query))
}

describe('DTSM event query filters', () => {
  it('uses the existing venue selection only when the query is empty', () => {
    expect(parse()).toEqual({
      filter: { venueIds: DEFAULT_DTSM_VENUE_IDS },
      canonicalQuery: ''
    })
  })

  it('parses every filter kind and canonicalizes order and duplicate IDs', () => {
    expect(
      parse('categories=81&venues=1201,%201137,1201&organizers=701')
    ).toEqual({
      filter: {
        venueIds: [1137, 1201],
        organizerIds: [701],
        categoryIds: [81]
      },
      canonicalQuery: 'venues=1137,1201&organizers=701&categories=81'
    })
  })

  it.each([
    ['unknown parameter', 'venue=1201'],
    ['empty list', 'venues='],
    ['empty item', 'venues=1201,,1137'],
    ['repeated parameter', 'venues=1201&venues=1137'],
    ['zero', 'venues=0'],
    ['negative integer', 'venues=-1'],
    ['leading zero', 'venues=01201'],
    ['decimal', 'venues=1.5'],
    ['exponent notation', 'venues=1e3'],
    ['unsafe integer', 'venues=9007199254740992']
  ])('rejects %s', (_label, query) => {
    expect(() => parse(query)).toThrow(InvalidRequestError)
  })

  it('uses a stable default key and canonical variant hashes', async () => {
    const defaultRequest = new Request('https://example.com/dtsm-events.ics')
    const customRequest = new Request(
      'https://example.com/dtsm-events.ics?venues=1201,1137,1201'
    )
    const defaultKey = await dtsmResponseCacheKey(defaultRequest)
    const first = await dtsmResponseCacheKey(customRequest)
    const equivalent = await dtsmResponseCacheKey(
      new Request('https://example.com/dtsm-events.ics?venues=1137,1201')
    )
    const different = await dtsmResponseCacheKey(
      new Request('https://example.com/dtsm-events.ics?venues=1201')
    )

    expect(defaultKey).toBe('dtsm-events.ics')
    expect(first).toMatch(/^dtsm-events\.ics:[a-f0-9]{64}$/)
    expect(equivalent).toBe(first)
    expect(different).not.toBe(first)
    expect(dtsmResponseCacheExpirationTtl(defaultRequest)).toBeUndefined()
    expect(dtsmResponseCacheExpirationTtl(customRequest)).toBe(
      CUSTOM_DTSM_CACHE_RETENTION_SECONDS
    )
  })
})
