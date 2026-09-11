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
    // ics depends on yup, which imports named exports from CommonJS packages
    // (property-expr). workerd can't resolve those unbundled, so pre-bundle ics
    // the way wrangler's esbuild does for deploys. See the Workers Vitest
    // integration's known issues, "Module resolution".
    deps: {
      optimizer: {
        ssr: {
          enabled: true,
          include: ['ics']
        }
      }
    },
    coverage: {
      provider: 'istanbul'
    }
  }
})
