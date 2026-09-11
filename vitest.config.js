import { cloudflareTest } from '@cloudflare/vitest-plugin'
import { configDefaults, defineConfig } from 'vitest/config'

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
    // Agent worktrees under .claude/ carry their own copy of the test suite.
    exclude: [...configDefaults.exclude, '.claude/**'],
    coverage: {
      provider: 'istanbul'
    }
  }
})
