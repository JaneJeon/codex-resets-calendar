import { describe, expect, it } from 'vitest'
import { calendars, findCalendar } from '../../../src/calendars/index.js'

describe('calendar registry', () => {
  it('gives every calendar a unique .ics path', () => {
    const paths = calendars.map(calendar => calendar.path)
    expect(new Set(paths).size).toBe(paths.length)
    for (const path of paths) {
      expect(path).toMatch(/^\/[a-z0-9-]+\.ics$/)
    }
  })

  it('gives every calendar a name, a whole-second cache TTL, and a builder', () => {
    for (const calendar of calendars) {
      expect(calendar.name).toBeTruthy()
      expect(Number.isInteger(calendar.cacheTtlSeconds)).toBe(true)
      expect(calendar.cacheTtlSeconds).toBeGreaterThan(0)
      expect(typeof calendar.buildEvents).toBe('function')
    }
  })

  it('finds a calendar by its exact path only', () => {
    expect(findCalendar('/codex-resets.ics')?.name).toBe('Codex Resets')
    expect(findCalendar('/codex-resets.ics/')).toBeUndefined()
    expect(findCalendar('/')).toBeUndefined()
  })

  it('registers the Downtown San Mateo feed', () => {
    expect(findCalendar('/dtsm-events.ics')?.name).toBe(
      'Downtown San Mateo Events'
    )
  })
})
