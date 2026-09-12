import { UpstreamError } from '@/errors.js'

export interface ResponseCacheStore {
  getWithMetadata<Metadata = unknown>(
    key: string
  ): Promise<{ value: string | null; metadata: Metadata | null }>
  put(
    key: string,
    value: string,
    options?: { metadata?: unknown }
  ): Promise<void>
}

export interface ResponseCacheOptions {
  store: ResponseCacheStore
  key: string
  freshnessSeconds: number
  label: string
  build: () => Promise<string>
}

interface ResponseCacheMetadata {
  cachedAt?: number
}

export async function withResponseCache({
  store,
  key,
  freshnessSeconds,
  label,
  build
}: ResponseCacheOptions): Promise<string> {
  let cachedBody: string | undefined

  try {
    const cached = await store.getWithMetadata<ResponseCacheMetadata>(key)
    if (cached.value) {
      cachedBody = cached.value
      const cachedAt = cached.metadata?.cachedAt
      const ageSeconds =
        typeof cachedAt === 'number' ? (Date.now() - cachedAt) / 1000 : Infinity

      if (ageSeconds >= 0 && ageSeconds < freshnessSeconds) {
        return cached.value
      }
    }
  } catch (error: unknown) {
    console.warn(`${label} response cache read failed`, error)
  }

  try {
    const body = await build()

    try {
      await store.put(key, body, { metadata: { cachedAt: Date.now() } })
    } catch (error: unknown) {
      console.warn(`${label} response cache write failed`, error)
    }

    return body
  } catch (error: unknown) {
    if (error instanceof UpstreamError && cachedBody) {
      console.warn(`${label} refresh failed, serving cached response`, error)
      return cachedBody
    }
    throw error
  }
}
