import { applyD1Migrations, type D1Migration } from 'cloudflare:test'
import { env } from 'cloudflare:workers'
import { beforeAll } from 'vitest'

beforeAll(async () => {
  const testEnv = env as Env & { TEST_D1_MIGRATIONS: D1Migration[] }
  await applyD1Migrations(testEnv.CALENDAR_DB, testEnv.TEST_D1_MIGRATIONS)
})
