/** Google's view — deterministic explanations of GSC not-indexed reasons. */

export type GooglesViewVerdict = 'EXPECTED' | 'PROBLEM' | 'INFO'

export type GooglesViewReasonKind =
  | 'page_with_redirect'
  | 'alternate_canonical'
  | 'not_found_404'
  | 'crawled_not_indexed'
  | 'discovered_not_indexed'
  | 'other'

export type RedirectHopEvidence = {
  url: string
  status: number
  location: string | null
}

export type RedirectChainEvidence = {
  hops: RedirectHopEvidence[]
  finalUrl: string
  finalStatus: number
  finalSelfCanonical: boolean
}

export type RedirectClassification = {
  verdict: GooglesViewVerdict
  problem: boolean
  problemReasons: string[]
  summary: string
  chain: RedirectChainEvidence
}

export type UrlVerdictDetail = {
  url: string
  destinationOrStatus: string
  verdict: GooglesViewVerdict
  problem: boolean
  detail: string
  problemReasons?: string[]
  /** Topic ids to link when PROBLEM (e.g. 26, 42, 1). */
  relatedTopics?: string[]
  indexDiagnosisCauses?: string[]
}

export type GooglesViewRow = {
  reason: string
  reasonKind: GooglesViewReasonKind
  pageCount: number
  problem: boolean
  whatToDo: string
  urls: UrlVerdictDetail[]
}

export type GooglesViewTable = {
  siteId: string
  rows: GooglesViewRow[]
  framing: string
}

export type IndexDiagnosisCauseSnippet = {
  url: string
  causes: string[]
}
