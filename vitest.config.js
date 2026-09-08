import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          RUN_E2E: process.env.RUN_E2E ?? '',
          DEPLOYED_URL: process.env.DEPLOYED_URL ?? ''
        }
      }
    })
  ],
  test: {
    coverage: {
      provider: 'istanbul'
    }
  }
})
