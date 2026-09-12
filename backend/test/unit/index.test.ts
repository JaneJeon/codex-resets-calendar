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
const request = new Request('https://example.com/test.ics')

describe('buildCalendarBody', () => {
  it('serializes events for a calendar without a custom response builder', async () => {
    const body = await buildCalendarBody(baseCalendar, {} as Env, request)

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
      testEnv,
      request
    )

    expect(body).toContain('SUMMARY:Test event')
    expect(buildEvents).toHaveBeenCalledOnce()
    expect(store.put).toHaveBeenCalledWith('test.ics', body, {
      metadata: { cachedAt: expect.any(Number) }
    })
  })

  it('resolves a request-derived retained-response cache key', async () => {
    const store: ResponseCacheStore = {
      getWithMetadata: vi.fn(async () => ({ value: null, metadata: null })),
      put: vi.fn(async () => {})
    }
    const key = vi.fn(async (value: Request) => {
      return `test.ics:${new URL(value.url).searchParams.get('view')}`
    })

    await buildCalendarBody(
      {
        ...baseCalendar,
        responseCache: {
          key,
          freshnessSeconds: 3600,
          expirationTtlSeconds: async () => 30 * 24 * 60 * 60
        }
      },
      { CALENDAR_CACHE: store } as unknown as Env,
      new Request('https://example.com/test.ics?view=custom')
    )

    expect(key).toHaveBeenCalledOnce()
    expect(store.put).toHaveBeenCalledWith(
      'test.ics:custom',
      expect.any(String),
      {
        metadata: { cachedAt: expect.any(Number) },
        expirationTtl: 30 * 24 * 60 * 60
      }
    )
  })

  it('turns an unavailable D1 binding into an upstream error', async () => {
    const calendar = calendars.find(value => value.path === '/dtsm-events.ics')!
    await expect(
      calendar.buildEvents(
        {} as Env,
        new Request('https://example.com/dtsm-events.ics')
      )
    ).rejects.toThrow('DTSM database unavailable')
  })
})
