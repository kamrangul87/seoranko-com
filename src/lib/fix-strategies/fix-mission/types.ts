export type FixMissionEligibility = 'safe' | 'review' | 'blocked'

export type FixMissionStatus = 'planned' | 'cancelled'

export type SiteConnectorKind =
  | 'github'
  | 'wordpress'
  | 'shopify'
  | 'webflow'
  | 'universal'
  | null

export type ClassifySiteContext = {
  /** Active CMS/repo connector for the site, or null when none linked. */
  connector: SiteConnectorKind
  /** True when credentials exist and the connector can be used. */
  connected: boolean
}

export type ClassifiableFinding = {
  id: string
  topicId: string
  verdict: string
  bucket: string
  surfaceClass?: string | null
  affectedUrlCount: number
  declarationSite?: string | null
  sourcePath?: string | null
  pageUrl?: string | null
  detail?: string | null
}

export type ClassifyFindingResult = {
  eligibility: FixMissionEligibility
  reason: string
  findingCode: string
  strategyId: string | null
}

export type FixMissionCounts = {
  totalActionable: number
  safe: number
  review: number
  blocked: number
}

export type FixMissionItemRow = {
  id: string
  missionId: string
  findingId: string
  findingCode: string
  strategyId: string | null
  eligibility: FixMissionEligibility
  blockReason: string
  status: 'pending'
  orderIndex: number
  createdAt: string
  updatedAt: string
  /** Joined presentation fields (optional). */
  pageUrl?: string | null
  verdict?: string | null
  detail?: string | null
  affectedUrlCount?: number | null
}

export type FixMissionRow = {
  id: string
  siteId: string
  userId: string
  crawlRunId: string | null
  status: FixMissionStatus
  counts: FixMissionCounts
  createdAt: string
  updatedAt: string
  items: FixMissionItemRow[]
}
