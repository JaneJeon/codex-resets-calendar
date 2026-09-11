import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import App from './App'

describe('App', () => {
  it('renders the shared calendar routes', () => {
    const markup = renderToStaticMarkup(<App />)

    expect(markup).toContain('Calendars')
    expect(markup).toContain('/codex-resets.ics')
    expect(markup).toContain('/dtsm-events.ics')
  })
})
