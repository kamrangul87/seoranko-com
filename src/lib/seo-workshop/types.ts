// Shared types for the SEO Workshop issue/repair data model.
// Colocated here (not per-lib-file) because ingestion, priority scoring,
// the Repair Order UI and Service History all need the same vocabulary —
// see Phase 0 plan §C decision 3.

export type SeoIssueSeverity = 'critical' | 'warning' | 'notice'

// Deliberately distinct from severity (which grades the issue itself):
// impact is "how much this matters" and reuses the vocabulary RANKO's
// diagnosis system already established (ranko-diagnosis.ts IssueImpact).
export type SeoIssueImpact = 'critical' | 'high' | 'medium' | 'low'

export type SeoIssueConfidence = 'high' | 'medium' | 'low'

export type SeoIssueEffort = '2min' | '30min' | '1hour'

export type SeoIssueActionability =
  | 'AUTO_FIXABLE'
  | 'HUMAN_GUIDED'
  | 'NOT_ACTIONABLE_AUTOMATICALLY'

export type SeoIssueStatus =
  | 'NEW'
  | 'PRIORITIZED'
  | 'IN_PROGRESS'
  | 'FIXED'
  | 'VERIFYING'
  | 'VERIFIED'
  | 'FAILED_VERIFICATION'
  | 'DISMISSED'

export const TERMINAL_ISSUE_STATUSES: SeoIssueStatus[] = ['FIXED', 'VERIFIED', 'DISMISSED']

export type SeoIssueDependencyType =
  | 'CAUSES'
  | 'AFFECTS'
  | 'DUPLICATES'
  | 'DEPENDS_ON'
  | 'RESOLVES'
  | 'REGRESSION_OF'

export type SeoIssueRelationshipConfidence = 'high' | 'medium' | 'low' | 'insufficient'

export interface SeoIssueRow {
  id: string
  user_id: string
  site_id: string
  audit_id: string | null
  issue_key: string
  category: string
  severity: SeoIssueSeverity
  impact: SeoIssueImpact
  title: string
  page_url: string | null
  affected_url_count: number
  affected_urls: string[]
  implementation_effort: SeoIssueEffort | null
  confidence: SeoIssueConfidence | null
  auto_fixable: boolean
  actionability: SeoIssueActionability
  priority_score: number | null
  root_cause_id: string | null
  status: SeoIssueStatus
  verification_status: string | null
  created_at: string
  updated_at: string
  resolved_at: string | null
}

export interface SeoServiceEventRow {
  id: string
  user_id: string
  site_id: string
  event_type:
    | 'INSPECTION_COMPLETED'
    | 'REPAIR_STARTED'
    | 'REPAIR_COMPLETED'
    | 'REPAIR_VERIFIED'
    | 'REPAIR_FAILED'
    | 'REGRESSION_DETECTED'
    | 'ISSUE_DISMISSED'
  audit_id: string | null
  issue_id: string | null
  summary: string
  detail: Record<string, unknown>
  created_at: string
}
