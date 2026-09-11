import { defineConfig } from 'drizzle-kit'

export default defineConfig({
  schema: ['./src/calendars/dtsm-events/schema.ts'],
  out: './migrations',
  dialect: 'sqlite',
  driver: 'd1-http',
  dbCredentials: {
    accountId: process.env.CLOUDFLARE_ACCOUNT_ID!,
    databaseId: '46a7cda1-e481-4e17-92a0-3fc1e5f65467',
    token: process.env.CLOUDFLARE_API_TOKEN!
  }
})
