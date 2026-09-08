import { env, exports } from 'cloudflare:workers'
import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'

const runE2E = env.RUN_E2E === '1'
const deployedUrl = env.DEPLOYED_URL

describe.skipIf(!runE2E)('live upstream', () => {
  it('builds a valid feed from the real API with at least 52 events', async () => {
    const response = await exports.default.fetch(
      'http://example.com/codex-resets.ics'
    )
    expect(response.status).toBe(200)

    const body = await response.text()
    const jcal = ICAL.parse(body)
    const component = new ICAL.Component(jcal)
    const events = component.getAllSubcomponents('vevent')

    expect(events.length).toBeGreaterThanOrEqual(52)

    const categories = new Set(
      events.flatMap(event => event.getFirstPropertyValue('categories') ?? [])
    )
    expect(categories.has('regular')).toBe(true)
    expect(categories.has('banked')).toBe(true)

    for (const event of events) {
      const dtstart = event.getFirstProperty('dtstart')
      if (dtstart?.getParameter('value') !== 'DATE') continue
      const start = event.getFirstPropertyValue('dtstart')
      const end = event.getFirstPropertyValue('dtend')
      const diffDays =
        (end.toJSDate() - start.toJSDate()) / (24 * 60 * 60 * 1000)
      expect(diffDays).toBeGreaterThanOrEqual(1)
    }
  })
})

describe.skipIf(!runE2E || !deployedUrl)('deployed feed', () => {
  it('serves a valid feed from the deployed URL', async () => {
    const response = await fetch(deployedUrl)
    expect(response.status).toBe(200)
    expect(response.headers.get('Content-Type')).toBe(
      'text/calendar; charset=utf-8'
    )

    const body = await response.text()
    const jcal = ICAL.parse(body)
    const component = new ICAL.Component(jcal)
    expect(
      component.getAllSubcomponents('vevent').length
    ).toBeGreaterThanOrEqual(52)
  })
})
