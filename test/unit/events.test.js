import { describe, expect, it } from 'vitest'
import {
  addDaysToDateString,
  buildEvents,
  laDateString
} from '../../src/events.js'

describe('laDateString', () => {
  it('converts a PDT instant to its Los Angeles calendar date', () => {
    expect(laDateString('2026-09-08T01:56:57.501Z')).toBe('20260907')
  })

  it('converts a PST instant to its Los Angeles calendar date', () => {
    expect(laDateString('2026-01-15T03:00:00.000Z')).toBe('20260114')
  })

  it('regression: the exact reported instant lands on 2026-09-07 in Los Angeles', () => {
    expect(laDateString('2026-09-08T01:56:57.501Z')).toBe('20260907')
  })
})

describe('addDaysToDateString', () => {
  it('adds one day across a month boundary', () => {
    expect(addDaysToDateString('20260930', 1)).toBe('20261001')
  })

  it('adds two days', () => {
    expect(addDaysToDateString('20260907', 2)).toBe('20260909')
  })
})

describe('buildEvents', () => {
  const resets = [
    {
      id: 'r1',
      reset_type: 'regular',
      announced_at: '2026-09-01T18:00:00.000Z',
      text: 'reset',
      source: { type: 'x_post', author: 'thsottiaux', url: 'https://x.com/a/1' }
    },
    {
      id: 'r2',
      reset_type: 'banked',
      announced_at: '2026-08-25T18:00:00.000Z',
      text: 'banked reset',
      source: { type: 'x_post', author: 'thsottiaux', url: 'https://x.com/a/2' }
    }
  ]

  it('distinguishes regular and banked past resets', () => {
    const events = buildEvents(resets, {})
    const regular = events.find(e => e.uid.startsWith('r1@'))
    const banked = events.find(e => e.uid.startsWith('r2@'))
    expect(regular.categories).toEqual(['regular'])
    expect(regular.summary).toBe('Codex Reset')
    expect(banked.categories).toEqual(['banked'])
    expect(banked.summary).toBe('Codex Reset (banked)')
  })

  it('produces a 60-minute block centered on scheduled_for, 30 minutes each side', () => {
    const status = {
      scheduled_reset: {
        id: 's1',
        status: 'scheduled',
        reset_type: 'regular',
        announced_at: '2026-09-10T12:00:00.000Z',
        scheduled_for: '2026-09-10T19:00:00.000Z',
        text: 'announced',
        source: {
          type: 'x_post',
          author: 'thsottiaux',
          url: 'https://x.com/a/3'
        }
      },
      active_watch: null
    }
    const events = buildEvents(resets, status)
    const scheduled = events.find(e => e.uid.startsWith('s1@'))
    expect(scheduled.allDay).toBe(false)
    expect(scheduled.start.toISOString()).toBe('2026-09-10T18:30:00.000Z')
    expect(scheduled.end.toISOString()).toBe('2026-09-10T19:30:00.000Z')
  })

  it('dedupes a scheduled reset that already appears in history, keeping the history version', () => {
    const status = {
      scheduled_reset: {
        id: 'r1',
        status: 'scheduled',
        reset_type: 'regular',
        announced_at: '2026-09-01T18:00:00.000Z',
        scheduled_for: null,
        text: 'announced',
        source: {
          type: 'x_post',
          author: 'thsottiaux',
          url: 'https://x.com/a/1'
        }
      },
      active_watch: null
    }
    const events = buildEvents(resets, status)
    const matching = events.filter(
      e => e.uid === 'r1@codex-resets-calendar.janejeon.workers.dev'
    )
    expect(matching).toHaveLength(1)
    expect(matching[0].summary).toBe('Codex Reset')
  })

  it('renders a watch spanning two Los Angeles days with DTEND two days after DTSTART', () => {
    const status = {
      scheduled_reset: null,
      active_watch: {
        level: 'elevated',
        reset_chance_percent: 62,
        forecast_window: 'soon',
        observed_at: '2026-09-07T23:00:00.000Z',
        expires_at: '2026-09-08T10:00:00.000Z',
        text: 'watch',
        source: { type: 'observed' }
      }
    }
    const events = buildEvents(resets, status)
    const watch = events.find(e => e.uid.startsWith('watch-'))
    expect(watch.startDate).toBe('20260907')
    expect(watch.endDate).toBe('20260909')
    expect(watch.summary).toBe('Codex Reset forecast (elevated, 62%)')
  })

  it('produces the same UIDs across two builds of identical input', () => {
    const first = buildEvents(resets, {})
    const second = buildEvents(resets, {})
    expect(first.map(e => e.uid).sort()).toEqual(second.map(e => e.uid).sort())
  })
})
