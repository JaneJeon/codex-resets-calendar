import { cloudflareTest, readD1Migrations } from '@cloudflare/vitest-plugin'
import { configDefaults, defineConfig } from 'vitest/config'

// The Worker needs no secrets, so don't let wrangler load .env (the Cloudflare
// API token) into the test Worker's env. This also silences wrangler's
// "Using secrets defined in .env" log on every test file.
process.env.CLOUDFLARE_LOAD_DEV_VARS_FROM_DOT_ENV ??= 'false'

const d1Migrations = await readD1Migrations('./migrations')

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: './wrangler.jsonc' },
      miniflare: {
        bindings: {
          TEST_D1_MIGRATIONS: d1Migrations,
          RUN_E2E: process.env.RUN_E2E ?? '',
          DEPLOYED_URL: process.env.DEPLOYED_URL ?? ''
        }
      }
    })
  ],
  test: {
    setupFiles: ['./test/setup.ts'],
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
          include: ['html-to-text', 'ics']
        }
      }
    },
    coverage: {
      provider: 'istanbul',
      include: ['src/**/*.ts'],
      exclude: ['src/vendor.d.ts'],
      thresholds: {
        statements: 100,
        branches: 100,
        functions: 100,
        lines: 100
      }
    }
  }
})
