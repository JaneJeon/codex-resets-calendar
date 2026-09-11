// A calendar's upstream source failed. The router turns it into a 502.
export interface UpstreamErrorOptions {
  status?: number
  retryAfter?: string | null
}

export class UpstreamError extends Error {
  readonly status?: number
  readonly retryAfter?: string | null

  constructor(message: string, options: UpstreamErrorOptions = {}) {
    super(message)
    this.name = 'UpstreamError'
    this.status = options.status
    this.retryAfter = options.retryAfter
  }
}
