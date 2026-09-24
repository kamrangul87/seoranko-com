import type { FetchEvidenceConfig } from './config'

export type FetchOutcomeKind =
  | 'http'
  | 'timeout'
  | 'connection-reset'
  | 'dns-failure'
  | 'network-error'

export type HttpStatusClass =
  | '404'
  | '410'
  | '4xx-other'
  | '429'
  | '503'
  | '5xx-other'
  | '3xx'
  | '2xx'
  | 'other'

export type FetchOutcome =
  | {
      kind: 'http'
      status: number
      statusClass: HttpStatusClass
      headers: Headers
      body: string
      url: string
      /** Topic 67: true only when the response stream was read to completion. */
      streamComplete: boolean
      /** Wall-clock ms (deps.now()) when this attempt completed. Topic 3's
       * persistent-5xx window needs a real timestamp, not just a relative
       * ordering, to compare against an observation from a prior crawl run. */
      observedAtMs: number
    }
  | {
      kind: 'timeout' | 'connection-reset' | 'dns-failure' | 'network-error'
      error: string
      url: string
      streamComplete: false
      observedAtMs: number
    }

export type EvidenceResult =
  | {
      stable: true
      outcome: FetchOutcome
      attempts: FetchOutcome[]
    }
  | {
      stable: false
      reason: 'unstable-status' | 'non-actionable'
      attempts: FetchOutcome[]
    }

export type FetchDeps = {
  fetch: typeof fetch
  sleep: (ms: number) => Promise<void>
  now: () => number
  config?: Partial<FetchEvidenceConfig>
}
