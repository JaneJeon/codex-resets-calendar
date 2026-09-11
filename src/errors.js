// A calendar's upstream source failed. The router turns it into a 502.
export class UpstreamError extends Error {
  constructor(message, options = {}) {
    super(message)
    this.name = 'UpstreamError'
    this.status = options.status
    this.retryAfter = options.retryAfter
  }
}
