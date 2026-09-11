import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { UpstreamError } from '@/errors.js'
import {
  withResponseCache,
  type ResponseCacheStore
} from '@/lib/response-cache.js'

type TestStore = ResponseCacheStore & { put: ReturnType<typeof vi.fn> }

function makeStore(value: string | null, cachedAt: number | null): TestStore {
  const getWithMetadata: ResponseCacheStore['getWithMetadata'] = async <
    Metadata
  >() => ({
    value,
    metadata: cachedAt === null ? null : ({ cachedAt } as Metadata)
  })

  return {
    getWithMetadata: vi.fn(
      getWithMetadata
    ) as ResponseCacheStore['getWithMetadata'],
    put: vi.fn(async () => {})
  }
}

const options = {
  key: 'feed',
  freshnessSeconds: 60 * 60,
  label: 'Test feed'
}

beforeEach(() => {
  vi.useFakeTimers()
  vi.setSystemTime(new Date('2026-09-11T12:00:00.000Z'))
})

afterEach(() => {
  vi.useRealTimers()
})

describe('withResponseCache', () => {
  it('reads an empty cache, builds the source, and writes the response', async () => {
    const store = makeStore(null, null)
    const build = vi.fn(async () => 'fresh')

    await expect(withResponseCache({ ...options, store, build })).resolves.toBe(
      'fresh'
    )
    expect(build).toHaveBeenCalledOnce()
    expect(store.put).toHaveBeenCalledWith(
      'feed',
      'fresh',
      expect.objectContaining({
        metadata: { cachedAt: Date.parse('2026-09-11T12:00:00.000Z') }
      })
    )
  })

  it('returns a fresh cached response without calling the source', async () => {
    const store = makeStore('cached', Date.now())
    const build = vi.fn(async () => 'fresh')

    await expect(withResponseCache({ ...options, store, build })).resolves.toBe(
      'cached'
    )
    expect(build).not.toHaveBeenCalled()
    expect(store.put).not.toHaveBeenCalled()
  })

  it('treats one second before expiry as fresh', async () => {
    const store = makeStore(
      'cached',
      Date.now() - (options.freshnessSeconds * 1000 - 1)
    )
    const build = vi.fn(async () => 'fresh')

    await expect(withResponseCache({ ...options, store, build })).resolves.toBe(
      'cached'
    )
    expect(build).not.toHaveBeenCalled()
  })

  it('treats the exact freshness boundary as stale and refreshes', async () => {
    const store = makeStore('old', Date.now() - options.freshnessSeconds * 1000)
    const build = vi.fn(async () => 'new')

    await expect(withResponseCache({ ...options, store, build })).resolves.toBe(
      'new'
    )
    expect(build).toHaveBeenCalledOnce()
    expect(store.put).toHaveBeenCalled()
  })

  it('refreshes when cache metadata is missing or from the future', async () => {
    for (const cachedAt of [null, Date.now() + 1]) {
      const store = makeStore('old', cachedAt)
      const build = vi.fn(async () => 'new')

      await expect(
        withResponseCache({ ...options, store, build })
      ).resolves.toBe('new')
      expect(build).toHaveBeenCalledOnce()
    }
  })

  it('refreshes stale data and writes the new response with a timestamp', async () => {
    const store = makeStore('old', Date.now() - 2 * 60 * 60 * 1000)
    const build = vi.fn(async () => 'new')

    await expect(withResponseCache({ ...options, store, build })).resolves.toBe(
      'new'
    )
    expect(build).toHaveBeenCalledOnce()
    expect(store.put).toHaveBeenCalledWith(
      'feed',
      'new',
      expect.objectContaining({
        metadata: { cachedAt: expect.any(Number) }
      })
    )
  })

  it('serves stale data indefinitely when every refresh fails upstream', async () => {
    const store = makeStore('old', Date.now() - 2 * 60 * 60 * 1000)
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const build = vi.fn(async () => {
      throw new UpstreamError('source unavailable')
    })

    await expect(withResponseCache({ ...options, store, build })).resolves.toBe(
      'old'
    )
    expect(store.put).not.toHaveBeenCalled()
    vi.advanceTimersByTime(365 * 24 * 60 * 60 * 1000)
    await expect(withResponseCache({ ...options, store, build })).resolves.toBe(
      'old'
    )
    expect(build).toHaveBeenCalledTimes(2)
    expect(store.put).not.toHaveBeenCalled()
    expect(warnSpy).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })

  it('rethrows non-upstream source errors instead of serving stale data', async () => {
    const store = makeStore('old', Date.now() - 2 * 60 * 60 * 1000)
    const build = vi.fn(async () => {
      throw new Error('invalid source data')
    })

    await expect(
      withResponseCache({ ...options, store, build })
    ).rejects.toThrow('invalid source data')
  })

  it('continues with a live response when cache read or write fails', async () => {
    const readStore = makeStore(null, null)
    vi.spyOn(readStore, 'getWithMetadata').mockRejectedValue(
      new Error('read down')
    )
    const writeStore = makeStore(null, null)
    writeStore.put.mockRejectedValue(new Error('write down'))
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})

    await expect(
      withResponseCache({
        ...options,
        store: readStore,
        build: async () => 'live'
      })
    ).resolves.toBe('live')
    await expect(
      withResponseCache({
        ...options,
        store: writeStore,
        build: async () => 'live'
      })
    ).resolves.toBe('live')
    expect(warnSpy).toHaveBeenCalledTimes(2)
    warnSpy.mockRestore()
  })
})
