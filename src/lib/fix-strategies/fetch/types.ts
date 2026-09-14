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
    }
  | {
      kind: 'timeout' | 'connection-reset' | 'dns-failure' | 'network-error'
      error: string
      url: string
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
