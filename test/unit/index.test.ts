import { describe, expect, it, vi } from 'vitest'
import type { CalendarDefinition } from '../../src/calendars/index.js'
import { buildCalendarBody } from '../../src/index.js'
import type { ResponseCacheStore } from '../../src/lib/response-cache.js'

const baseCalendar: CalendarDefinition = {
  path: '/test.ics',
  name: 'Test Calendar',
  cacheTtlSeconds: 60,
  buildEvents: async () => [
    {
      uid: 'event@example.com',
      title: 'Test event',
      start: [2026, 9, 11],
      end: [2026, 9, 12]
    }
  ]
}

describe('buildCalendarBody', () => {
  it('serializes events for a calendar without a custom response builder', async () => {
    const body = await buildCalendarBody(baseCalendar, {} as Env)

    expect(body).toContain('X-WR-CALNAME:Test Calendar')
    expect(body).toContain('SUMMARY:Test event')
  })

  it('wraps common serialization in retained-response caching when configured', async () => {
    const store: ResponseCacheStore = {
      getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
      put: vi.fn(async () => {})
    }
    const testEnv = { CALENDAR_CACHE: store } as unknown as Env
    const buildEvents = vi.fn(baseCalendar.buildEvents)

    const body = await buildCalendarBody(
      {
        ...baseCalendar,
        responseCache: { key: 'test.ics', freshnessSeconds: 3600 },
        buildEvents
      },
      testEnv
    )

    expect(body).toContain('SUMMARY:Test event')
    expect(buildEvents).toHaveBeenCalledOnce()
    expect(store.put).toHaveBeenCalledWith('test.ics', body, {
      metadata: { cachedAt: expect.any(Number) }
    })
  })
})
