import { describe, expect, it, vi } from 'vitest'
import type { CalendarDefinition } from '@/calendars/index.js'
import { buildCalendarBody } from '@/index.js'
import { calendars } from '@/calendars/index.js'
import type { ResponseCacheStore } from '@/lib/response-cache.js'

const baseCalendar: CalendarDefinition = {
  path: '/test.ics' as CalendarDefinition['path'],
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

  it('turns an unavailable D1 binding into an upstream error', async () => {
    const calendar = calendars.find(value => value.path === '/dtsm-events.ics')!
    await expect(calendar.buildEvents({} as Env)).rejects.toThrow(
      'DTSM database unavailable'
    )
  })
})
