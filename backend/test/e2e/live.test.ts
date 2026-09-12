import { env, exports } from 'cloudflare:workers'
import ICAL from 'ical.js'
import { describe, expect, it } from 'vitest'

const testEnv = env as typeof env & {
  RUN_E2E?: string
  DEPLOYED_URL?: string
}
const runE2E = testEnv.RUN_E2E === '1'
const deployedUrl = testEnv.DEPLOYED_URL

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
      const start = event.getFirstPropertyValue('dtstart') as {
        toJSDate(): Date
      } | null
      const end = event.getFirstPropertyValue('dtend') as {
        toJSDate(): Date
      } | null
      if (!start || !end) continue
      const diffDays =
        (end.toJSDate().getTime() - start.toJSDate().getTime()) /
        (24 * 60 * 60 * 1000)
      expect(diffDays).toBeGreaterThanOrEqual(1)
    }
  })

  it('stores the live DTSM catalog and builds a valid filtered feed', async () => {
    const response = await exports.default.fetch(
      'http://example.com/dtsm-events.ics'
    )
    expect(response.status).toBe(200)
    const component = new ICAL.Component(ICAL.parse(await response.text()))
    expect(component.getAllSubcomponents('vevent').length).toBeGreaterThan(0)
  }, 60_000)
})

describe.skipIf(!runE2E || !deployedUrl)('deployed feed', () => {
  it('serves a valid feed from the deployed URL', async () => {
    // The zone blocks requests without a User-Agent (AGENTS.md, Domain).
    const response = await fetch(deployedUrl!, {
      headers: { 'User-Agent': 'calendars-smoke-test' }
    })
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

  it('serves the deployed DTSM feed', async () => {
    const response = await fetch(new URL('/dtsm-events.ics', deployedUrl!), {
      headers: { 'User-Agent': 'calendars-smoke-test' }
    })
    expect(response.status).toBe(200)
    const component = new ICAL.Component(ICAL.parse(await response.text()))
    expect(component.getAllSubcomponents('vevent').length).toBeGreaterThan(0)
  })

  it('serves a deployed filtered DTSM view', async () => {
    const response = await fetch(
      new URL('/dtsm-events.ics?venues=999999999', deployedUrl!),
      { headers: { 'User-Agent': 'calendars-smoke-test' } }
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('Cache-Control')).toBe('public, max-age=3600')
    const component = new ICAL.Component(ICAL.parse(await response.text()))
    expect(component.getAllSubcomponents('vevent')).toHaveLength(0)
  })
})
