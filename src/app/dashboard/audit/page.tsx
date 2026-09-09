'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DashboardNav } from '@/components/DashboardNav'
import { IndexDiagnosisPanel } from '@/components/IndexDiagnosisPanel'
import { LinkGraphPanel } from '@/components/LinkGraphPanel'
import { AuditPasteFix } from '@/components/AuditPasteFix'
import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'

import type { PageAuditFixMetadata } from '@/lib/page-audit-engine'

interface AuditIssue {
  id: string
  severity: string
  category: string
  title: string
  description: string
  remediation?: string
  fixMetadata?: PageAuditFixMetadata
}

interface AuditResult {
  url: string
  score: number
  searchScore: number
  aiScore: number
  httpStatus: number
  siteType: {
    siteType: string
    confidence: string
    signals: string[]
    pageRole: string | null
  }
  issues: AuditIssue[]
  opportunities: string[]
  explainable: {
    dimensions: Array<{ id: string; label: string; status: string; summary: string }>
    score: number
    scoreExplanation: string
    publishDecision: string
    publishDecisionReason: string
  }
  signals: {
    title: string
    h1: string
    wordCount: number
    hasSchema: boolean
    hasProductSchema: boolean
  }
  history: Array<{ auditedAt: string; score: number }>
  crawlNotes: string[]
  coreWebVitalsPending?: boolean
  coreWebVitals?: {
    dataMode: string
    labFallbackUsed: boolean
    error?: string
    metrics: Array<{
      id: string
      label: string
      displayValue: string
      rating: string
      source: string
    }>
  }
  indexDiagnosis?: IndexDiagnosisResult | null
  indexDiagnosisRunId?: string | null
  indexDiagnosisPersistOk?: boolean
  indexDiagnosisPersistError?: string | null
  auditScope?: {
    urlsDiscovered: number
    urlsFetched: number
  }
  /** True when panels were restored from DB without a fresh Quality Gate scan. */
  restoredFromSaved?: boolean
}

interface ConnectionStatus {
  connected: boolean
  siteId?: string
  domain?: string
  brand?: string
  cmsType?: string
  lastVerifiedAt?: string | null
  prompt?: string
  fixableScope?: string
  isUniversalTag?: boolean
  canFixHeaders?: boolean
  needsExactSiteRegistration?: boolean
  suggestedDomain?: string
  parentDomain?: string
}

interface FixAttempt {
  id: string
  issueId?: string
  issue_id?: string
  issueTitle?: string
  issue_title?: string
  autoKind?: string
  auto_kind?: string
  strategy: string
  attemptNumber?: number
  attempt_number?: number
  status: string
  diffSummary?: string | null
  diff_summary?: string | null
  verificationDetail?: string | null
  verification_detail?: string | null
  errorMessage?: string | null
  error_message?: string | null
  targetUrl?: string | null
  target_url?: string | null
  issueKey?: string | null
  issue_key?: string | null
  pendingKind?: 'deploy' | 'merge' | null
  pendingUrl?: string | null
  revertible: boolean
  scoreBefore?: number | null
  score_before?: number | null
  scoreAfter?: number | null
  score_after?: number | null
}

function formatAttemptStatus(status: string): string {
  if (status === 'verified') return 'verified (live)'
  if (status === 'unverified' || status === 'pending_deploy') {
    return 'unverified — not confirmed live'
  }
  if (status === 'pr_pending' || status === 'pending_merge') {
    return 'pr_pending — not confirmed live'
  }
  if (status === 'applied') return 'unverified (legacy applied)'
  if (status === 'handed_off') return 'handed off'
  return status
}

function extractPrUrl(text: string | null | undefined): string | null {
  if (!text) return null
  const m = text.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/i)
  return m ? m[0] : null
}

function attemptErrorText(a: FixAttempt): string | null {
  const err = a.errorMessage || a.error_message
  if (err) return err
  const status = a.status || ''
  if (status === 'failed' || status === 'handed_off') {
    return a.verificationDetail || a.verification_detail || 'Failed (no error detail recorded)'
  }
  return null
}

function attemptWritePathLabel(a: FixAttempt): string {
  const blob = [
    a.errorMessage,
    a.error_message,
    a.verificationDetail,
    a.verification_detail,
    a.diffSummary,
    a.diff_summary,
    a.strategy,
  ]
    .filter(Boolean)
    .join(' ')
  if (/Direct push blocked[\s\S]*PR fallback also failed/i.test(blob)) {
    return 'Direct push blocked → PR-fallback attempt'
  }
  if (/PR fallback is disabled/i.test(blob)) {
    return 'Direct-push attempt'
  }
  if (/seoranko-fix|review branch|commit to review branch|Pull Request could not be opened/i.test(blob)) {
    return 'PR-fallback attempt'
  }
  if (/GitHub|commit failed|Contents|protected branch|Resource not accessible|HTTP 40[0-9]|HTTP 42[0-9]/i.test(blob)) {
    return 'Direct-push attempt'
  }
  return 'Did not reach GitHub write'
}

/** One card per failed auto-fix issue — prefer handed_off, else newest failed (list is newest-first).
 * Human-handoff rows have their own "Human tasks" section and are excluded here. */
function collectFailedAttempts(attempts: FixAttempt[]): FixAttempt[] {
  const map = new Map<string, FixAttempt>()
  for (const a of attempts) {
    if (a.status !== 'failed' && a.status !== 'handed_off') continue
    if (a.strategy === 'human-handoff') continue
    const key = String(a.issueId || a.issue_id || a.issueTitle || a.issue_title || a.id)
    const prev = map.get(key)
    if (!prev) {
      map.set(key, a)
      continue
    }
    if (prev.status !== 'handed_off' && a.status === 'handed_off') {
      map.set(key, a)
    }
  }
  return Array.from(map.values())
}

interface HumanTask {
  kind: string
  title: string
  reason: string
  suggestedAction: string
  briefHint?: string
}

const SECURITY_ISSUE_RE = /x-frame-options|x-content-type|content-security-policy|security header|hsts/i
const LLMS_ISSUE_RE = /llms\.txt/i
const SERVER_REQUIRED_HINT =
  'Requires server access — connect via WordPress/Shopify/GitHub to auto-fix, or fix manually'

function classifyClientSide(
  issue: AuditIssue,
  cmsType?: string | null,
): { label: 'auto' | 'human' | 'skip' | 'server'; hint?: string } {
  const meta = issue.fixMetadata?.kind
  const isCms = cmsType === 'wordpress' || cmsType === 'shopify' || cmsType === 'webflow' || cmsType === 'github'

  if (meta === 'missing-page-content') return { label: 'human' }
  if (meta === 'redirect-canonical' || meta === 'remove-dead-link' || meta === 'sitemap-regenerate' || meta === 'rewrite-link-href') {
    if (isCms) return { label: 'auto' }
    return { label: 'server', hint: SERVER_REQUIRED_HINT }
  }

  const hay = `${issue.id} ${issue.title} ${issue.description} ${issue.category}`
  if (/thin content|low word count|lacks indexable|placeholder product|ecom-description-thin|ecom-category-thin|ecom-description-placeholder/i.test(hay)) {
    return { label: 'human' }
  }
  if (/internal link|related-product linking|orphan|ecom-related-links/i.test(hay)) return { label: 'human' }
  if (/availability mismatch|pricing|stock claim|policy statement|ecom-availability-mismatch/i.test(hay)) {
    return { label: 'human' }
  }

  const needsServer = SECURITY_ISSUE_RE.test(hay) || LLMS_ISSUE_RE.test(hay)
  if (needsServer) {
    const isCms = cmsType === 'wordpress' || cmsType === 'shopify' || cmsType === 'webflow' || cmsType === 'github'
    if (cmsType === 'universal-tag' || !cmsType || !isCms) {
      return { label: 'server', hint: SERVER_REQUIRED_HINT }
    }
    return { label: 'auto' }
  }

  if (
    /idx-canonical-|idx-dead-link-remove|idx-sitemap-drift|redirect-canonical|remove dead internal link|sitemap out of date/i.test(
      hay,
    )
  ) {
    if (/idx-dead-page-|destination page missing/i.test(hay)) return { label: 'human' }
    if (isCms) return { label: 'auto' }
    return { label: 'server', hint: SERVER_REQUIRED_HINT }
  }

  if (
    /title tag|meta title|title too (long|short)|meta_title|audit-meta_title|meta description|missing h1|no structured data|organization schema|article schema|product schema|breadcrumb|lang attribute|alt text|html structure|ecom-product|ecom-offer|ecom-image-alt|ecom-breadcrumb|ecom-category-missing-h1|ecom-title-templated/i.test(
      hay,
    )
  ) {
    return { label: 'auto' }
  }
  if (issue.category === 'schema' && issue.severity !== 'info' && !/review|rating/i.test(hay)) {
    return { label: 'auto' }
  }
  if (issue.severity === 'info') return { label: 'skip' }
  return { label: 'human' }
}

function buildFixConfirmMessage(connection: ConnectionStatus, issues: AuditIssue[]): string {
  const cms = connection.cmsType || 'connected site'
  const autoTitles = issues
    .map((i) => ({ i, c: classifyClientSide(i, connection.cmsType) }))
    .filter((x) => x.c.label === 'auto')
    .map((x) => x.i.title)
    .slice(0, 8)
  const serverBlocked = issues
    .map((i) => ({ i, c: classifyClientSide(i, connection.cmsType) }))
    .filter((x) => x.c.label === 'server')
    .map((x) => x.i.title)
    .slice(0, 5)

  const scope =
    connection.fixableScope ||
    (connection.isUniversalTag
      ? 'Universal Tag can only change post-load DOM (meta, schema, H1, alt) — not HTTP headers.'
      : `Fixes will use your ${cms} connection.`)

  let msg = `Run Fix Agent on ${connection.domain} only?\n\n${scope}\n\n`
  if (autoTitles.length) {
    msg += `Will attempt (${autoTitles.length}+):\n- ${autoTitles.join('\n- ')}\n\n`
  } else {
    msg += 'No auto-fixable issues for this connection type.\n\n'
  }
  if (serverBlocked.length) {
    msg += `Not auto-fixed via ${cms} (needs server/CMS):\n- ${serverBlocked.join('\n- ')}\n\n`
  }
  msg += 'Thin content and linking issues become human tasks — never auto-published. You can review and revert each change.'
  return msg
}

export default function AuditPage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [fixRunning, setFixRunning] = useState(false)
  const [fixMessage, setFixMessage] = useState<string | null>(null)
  const [attempts, setAttempts] = useState<FixAttempt[]>([])
  const [humanTasks, setHumanTasks] = useState<HumanTask[]>([])
  const [failedAttemptsOpen, setFailedAttemptsOpen] = useState(true)
  const [scoreAfterFix, setScoreAfterFix] = useState<number | null>(null)
  const [cwvLoading, setCwvLoading] = useState(false)
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null)
  const [cspProposal, setCspProposal] = useState<{
    policyHeader: string
    origins: string[]
    newOrigins: string[]
    status: string
    message: string
  } | null>(null)
  const [cspBusy, setCspBusy] = useState(false)
  const [savedLinkGraph, setSavedLinkGraph] = useState<{
    auditId: string
    createdAt?: string
    summary: {
      verdictHeadline: string
      topCauses: Array<{
        ruleId: string
        title: string
        affectedCount: number
        whyItMatters: string
        whatToChange: string
      }>
      findingCount: number
      criticalCount: number
      failCount: number
      warnCount: number
      jsSuspected?: boolean
      trailingSlashConvention?: boolean
    }
    topFindings: Array<{
      ruleId?: string
      rule_id?: string
      severity: string
      sourceUrl?: string | null
      source_url?: string | null
      targetUrl?: string | null
      target_url?: string | null
      suggestedTarget?: string | null
      suggested_target?: string | null
      evidence?: Record<string, unknown>
    }>
  } | null>(null)
  const [savedMeta, setSavedMeta] = useState<string | null>(null)

  const failedAttempts = collectFailedAttempts(attempts)

  const loadSavedAudits = useCallback(async (domainOrUrl: string, opts?: { hydrateDiagnosis?: boolean }) => {
    const hydrateDiagnosis = opts?.hydrateDiagnosis !== false
    try {
      const res = await fetch(`/api/audit/saved?url=${encodeURIComponent(domainOrUrl)}`)
      if (!res.ok) return
      const data = await res.json()
      if (data.tablesMissing) {
        setPersistenceWarning(
          'Index Diagnosis / Link Graph tables are missing on hosted Supabase — apply migrations, then re-scan.',
        )
        return
      }
      if (data.linkGraph) setSavedLinkGraph(data.linkGraph)

      // Never silently restore empty/stub Quality Gate or empty Index Diagnosis.
      if (hydrateDiagnosis && data.needsFreshCrawl) {
        setSavedMeta(data.needsFreshCrawlReason || 'Stored audit is incomplete — scanning fresh…')
        setUrl((prev) => prev || domainOrUrl)
        // Defer so url state + session restore settle, then run a real crawl.
        queueMicrotask(() => {
          void (async () => {
            setLoading(true)
            setError(null)
            try {
              const scanRes = await fetch('/api/copilot/audit', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ url: domainOrUrl }),
              })
              const scanData = await scanRes.json()
              if (!scanRes.ok) throw new Error(scanData.error || 'Audit failed')
              setAudit(scanData.audit)
              setSavedMeta(null)
              try {
                sessionStorage.setItem('seoranko:last-audit-url', scanData.audit.url)
              } catch {
                /* ignore */
              }
              if (scanData.audit?.indexDiagnosis?.coverage?.domain) {
                void loadSavedAudits(scanData.audit.indexDiagnosis.coverage.domain, {
                  hydrateDiagnosis: false,
                })
              }
              if (scanData.audit?.coreWebVitalsPending !== false) {
                void fetchCoreWebVitalsAsync(scanData.audit.url)
              }
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Audit failed')
            } finally {
              setLoading(false)
            }
          })()
        })
        return
      }

      if (!hydrateDiagnosis || !data.indexDiagnosis || !data.pageAudit) return

      setSavedMeta(
        data.indexDiagnosisCreatedAt
          ? `Showing saved Index Diagnosis from ${new Date(data.indexDiagnosisCreatedAt).toLocaleString()}. Scan to refresh.`
          : 'Showing saved Index Diagnosis. Scan to refresh.',
      )
      setAudit((prev) => {
        if (prev && !prev.restoredFromSaved) {
          // Keep a live scan's richer payload (htmlByUrl / sitemapDrift); only fill if missing.
          if (prev.indexDiagnosis) return prev
          return {
            ...prev,
            indexDiagnosis: data.indexDiagnosis,
            indexDiagnosisRunId: data.indexDiagnosisRunId,
          }
        }
        const pa = data.pageAudit
        return {
          url: pa.url || data.indexDiagnosis.coverage.seedUrl || domainOrUrl,
          score: pa.score,
          searchScore: prev?.searchScore ?? pa.score,
          aiScore: prev?.aiScore ?? 0,
          httpStatus: pa.httpStatus,
          siteType: prev?.siteType ?? {
            siteType: 'unknown',
            confidence: 'low',
            signals: [],
            pageRole: null,
          },
          issues: pa.issues || [],
          opportunities: (Array.isArray(pa.opportunities) ? pa.opportunities : []) as string[],
          explainable: pa.explainable || {
            dimensions: [],
            score: pa.score,
            scoreExplanation: 'Restored from last saved Quality Gate.',
            publishDecision: 'review',
            publishDecisionReason: 'Restored snapshot — re-scan to refresh.',
          },
          signals: {
            title: pa.title || '',
            h1: pa.h1 || '',
            wordCount: pa.wordCount ?? 0,
            hasSchema: !!pa.hasSchema,
            hasProductSchema: false,
          },
          history: prev?.history ?? [],
          crawlNotes: [
            'Restored last saved Index Diagnosis and Quality Gate from the database (no re-crawl).',
            ...(prev?.crawlNotes || []),
          ],
          indexDiagnosis: data.indexDiagnosis,
          indexDiagnosisRunId: data.indexDiagnosisRunId,
          restoredFromSaved: true,
          auditScope: {
            urlsDiscovered: data.indexDiagnosis.coverage.discoveredCount,
            urlsFetched: data.indexDiagnosis.coverage.fetchedCount,
          },
        }
      })
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    try {
      const last = sessionStorage.getItem('seoranko:last-audit-url')
      if (last) {
        setUrl(last)
        void loadSavedAudits(last)
      }
    } catch {
      /* ignore */
    }
  }, [loadSavedAudits])

  // Surface missing Index Diagnosis / Link Graph tables before the user re-scans.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch('/api/audit/health')
        if (!res.ok || cancelled) return
        const data = await res.json()
        if (cancelled) return
        if (data.ok === false && data.migration) {
          setPersistenceWarning(data.migration)
        }
      } catch {
        /* ignore */
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const fetchCoreWebVitalsAsync = useCallback(async (auditUrl: string) => {
    setCwvLoading(true)
    try {
      const res = await fetch('/api/copilot/audit/cwv', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: auditUrl }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Core Web Vitals check failed')

      setAudit((prev) => {
        if (!prev || prev.url !== auditUrl) return prev
        const mergedIssues = [
          ...prev.issues.filter((i) => i.category !== 'core-web-vitals'),
          ...(data.issues || []),
        ]
        const dimensions = prev.explainable.dimensions.map((d) =>
          d.id === 'core_web_vitals' && data.dimension
            ? { ...d, status: data.dimension.status, summary: data.dimension.summary }
            : d,
        )
        const crawlNotes = data.crawlNote
          ? [...prev.crawlNotes.filter((n) => !n.startsWith('Core Web Vitals:')), data.crawlNote]
          : prev.crawlNotes
        return {
          ...prev,
          coreWebVitalsPending: false,
          coreWebVitals: data.coreWebVitals,
          issues: mergedIssues,
          explainable: { ...prev.explainable, dimensions },
          crawlNotes,
        }
      })
    } catch (err) {
      setAudit((prev) => {
        if (!prev || prev.url !== auditUrl) return prev
        const note = `Core Web Vitals: ${err instanceof Error ? err.message : 'check failed'}`
        return {
          ...prev,
          coreWebVitalsPending: false,
          crawlNotes: [...prev.crawlNotes.filter((n) => !n.startsWith('Core Web Vitals:')), note],
        }
      })
    } finally {
      setCwvLoading(false)
    }
  }, [])

  const refreshConnection = useCallback(async (auditUrl: string) => {
    try {
      const res = await fetch(`/api/copilot/site-connection?url=${encodeURIComponent(auditUrl)}`)
      if (!res.ok) {
        setConnection({ connected: false, prompt: 'Could not check site connection.' })
        return
      }
      const data = await res.json()
      setConnection(data)
    } catch {
      setConnection({ connected: false, prompt: 'Could not check site connection.' })
    }
  }, [])

  const refreshAttempts = useCallback(async (auditUrl: string, siteId?: string | null) => {
    try {
      const params = new URLSearchParams({ url: auditUrl })
      if (siteId) params.set('siteId', siteId)
      const res = await fetch(`/api/copilot/fix-agent?${params.toString()}`)
      if (!res.ok) return
      const data = await res.json()
      if (!Array.isArray(data.attempts)) return
      // Never wipe in-memory POST results with an empty refetch (URL-match miss).
      setAttempts((prev) => (data.attempts.length > 0 ? data.attempts : prev))
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    if (!audit?.url) return
    void refreshConnection(audit.url)
    void refreshAttempts(audit.url, connection?.siteId)
  }, [audit?.url, connection?.siteId, refreshConnection, refreshAttempts])

  async function runAudit() {
    setLoading(true)
    setError(null)
    setFixMessage(null)
    setHumanTasks([])
    setAttempts([])
    setScoreAfterFix(null)
    // Drop prior host's CMS connection so Auto-fix cannot flash for the wrong domain.
    setConnection(null)
    try {
      const res = await fetch('/api/copilot/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Audit failed')
      setAudit(data.audit)
      setSavedMeta(null)
      try {
        sessionStorage.setItem('seoranko:last-audit-url', data.audit.url)
      } catch {
        /* ignore */
      }
      if (data.audit?.indexDiagnosisPersistOk === false) {
        setPersistenceWarning(
          data.audit.indexDiagnosisPersistError ||
            'Index Diagnosis was not saved. Apply the index_diagnosis_runs migration on hosted Supabase.',
        )
      }
      // Refresh Link Graph panel from DB only — keep live crawl htmlByUrl intact.
      if (data.audit?.indexDiagnosis?.coverage?.domain) {
        void loadSavedAudits(data.audit.indexDiagnosis.coverage.domain, { hydrateDiagnosis: false })
      }
      if (data.audit?.coreWebVitalsPending !== false) {
        void fetchCoreWebVitalsAsync(data.audit.url)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Audit failed')
    } finally {
      setLoading(false)
    }
  }

  async function runFixAgent(
    issueFilter?: (i: AuditIssue) => boolean,
    overrideIssues?: AuditIssue[],
  ) {
    if (!audit) return
    if (!connection?.connected || !connection.siteId) {
      const host =
        connection?.suggestedDomain ||
        (() => {
          try {
            return new URL(audit.url).hostname.replace(/^www\./i, '')
          } catch {
            return 'this host'
          }
        })()
      setFixMessage(
        connection?.needsExactSiteRegistration
          ? `This fix requires connecting ${host} — go to Settings to connect it.`
          : connection?.prompt ||
              `This fix requires connecting ${host} — go to Settings to connect it.`,
      )
      return
    }
    const issuesToFix = overrideIssues
      ? overrideIssues
      : issueFilter
        ? audit.issues.filter(issueFilter)
        : audit.issues
    if (!issuesToFix.length) {
      setFixMessage('no crawl data available — run a scan first')
      return
    }
    const ok = window.confirm(buildFixConfirmMessage(connection, issuesToFix))
    if (!ok) return

    setFixRunning(true)
    setFixMessage(null)
    try {
      const res = await fetch('/api/copilot/fix-agent', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          url: audit.url,
          siteId: connection.siteId,
          issues: issuesToFix,
          scoreBefore: audit.score,
          confirm: true,
        }),
      })
      const data = await res.json()
      if (!res.ok && !data.applied) {
        throw new Error(data.message || data.error || 'Fix Agent failed')
      }
      setFixMessage(data.message || 'Done')
      setHumanTasks(data.humanTasks || [])
      if (typeof data.scoreAfter === 'number') setScoreAfterFix(data.scoreAfter)
      if (data.persistenceOk === false) {
        setPersistenceWarning(
          data.persistenceError ||
            'Attempts were not saved to the database. Apply the fix_agent_attempts migration on hosted Supabase.',
        )
      } else {
        setPersistenceWarning(null)
      }
      if (data.cspProposal) setCspProposal(data.cspProposal)
      if (Array.isArray(data.applied)) {
        setAttempts((prev) => [...data.applied, ...prev])
        const failedNow = collectFailedAttempts(data.applied as FixAttempt[])
        if (failedNow.length > 0) setFailedAttemptsOpen(true)
      }
      await refreshAttempts(audit.url, connection.siteId)
    } catch (err) {
      setFixMessage(err instanceof Error ? err.message : 'Fix Agent failed')
    } finally {
      setFixRunning(false)
    }
  }

  async function revertAttempt(attemptId: string) {
    if (!attemptId) return
    setFixRunning(true)
    try {
      const res = await fetch('/api/copilot/fix-agent/revert', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ attemptId }),
      })
      const data = await res.json()
      setFixMessage(data.message || (data.ok ? 'Reverted' : 'Revert failed'))
      if (audit?.url) await refreshAttempts(audit.url, connection?.siteId)
    } catch (err) {
      setFixMessage(err instanceof Error ? err.message : 'Revert failed')
    } finally {
      setFixRunning(false)
    }
  }

  return (
    <div className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden" style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}>
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <h1 className="text-2xl font-semibold mb-2">Site Audit</h1>
          <p className="text-[#6B6B6B] mb-6">
            Paste a URL. SEORANKO runs a domain Index Diagnosis crawl plus a Quality Gate check on the scanned page.
          </p>

          <div className="flex gap-2 mb-6">
            <input
              className="flex-1 border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white"
              placeholder="https://example.com/page"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              onClick={runAudit}
              disabled={loading || !url.trim()}
              className="px-4 py-2 rounded-lg bg-[#FF6B2C] text-white disabled:opacity-50"
            >
              {loading ? 'Scanning…' : 'Scan'}
            </button>
          </div>

          {error && <p className="text-red-600 mb-4">{error}</p>}
          {savedMeta && <p className="text-sm text-[#6B6B6B] mb-4">{savedMeta}</p>}

          {audit && (
            <div className="space-y-6">
              {audit.indexDiagnosis && (
                <IndexDiagnosisPanel
                  data={audit.indexDiagnosis}
                  siteId={connection?.siteId}
                  cmsConnected={connection?.connected}
                  onRegenerateSitemap={
                    connection?.connected
                      ? () => void runFixAgent((i) => i.id === 'idx-sitemap-drift')
                      : undefined
                  }
                  fixRunning={fixRunning}
                />
              )}

              {audit.indexDiagnosis && (
                <LinkGraphPanel
                  diagnosis={audit.indexDiagnosis}
                  domain={audit.indexDiagnosis.coverage.domain}
                  siteId={connection?.siteId}
                  cmsConnected={!!connection?.connected}
                  connectedDomain={connection?.domain ?? null}
                  auditUrl={audit.url}
                  fixRunning={fixRunning}
                  onRunFixAgent={(issues) => void runFixAgent(undefined, issues as AuditIssue[])}
                  initialSaved={savedLinkGraph}
                  fixConnectionHint={
                    connection
                      ? {
                          needsExactSiteRegistration: connection.needsExactSiteRegistration,
                          suggestedDomain: connection.suggestedDomain,
                          parentDomain: connection.parentDomain,
                          prompt: connection.prompt,
                        }
                      : {
                          prompt:
                            'Connect this site in Settings → Your Sites before Fix Agent can write.',
                        }
                  }
                />
              )}

              <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
                <div className="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                  <h2 className="font-medium">
                    {audit.indexDiagnosis ? 'Scanned page — Quality Gate' : 'Audit summary'}
                  </h2>
                  {audit.indexDiagnosis && (
                    <span className="text-xs text-[#9B9B9B]">
                      Single URL only · site crawl above covers {audit.indexDiagnosis.coverage.fetchedCount} pages
                    </span>
                  )}
                </div>
                <p className="text-xs text-[#6B6B6B] mb-3 break-all">{audit.url}</p>
                <div className="flex flex-wrap gap-4 items-baseline">
                  <div>
                    <div className="text-3xl font-semibold">{audit.score}</div>
                    <div className="text-xs text-[#9B9B9B]">Quality score (this URL)</div>
                  </div>
                  {scoreAfterFix != null && (
                    <div>
                      <div className="text-3xl font-semibold text-green-700">{scoreAfterFix}</div>
                      <div className="text-xs text-[#9B9B9B]">After Fix Agent</div>
                    </div>
                  )}
                  {!audit.indexDiagnosis && (
                    <>
                      <div>
                        <div className="text-lg">{audit.siteType.siteType}</div>
                        <div className="text-xs text-[#9B9B9B]">
                          site type · {audit.siteType.confidence}
                          {audit.siteType.pageRole ? ` · ${audit.siteType.pageRole}` : ''}
                        </div>
                      </div>
                      <div className="text-sm text-[#6B6B6B]">
                        HTTP {audit.httpStatus} · {audit.signals.wordCount} words ·{' '}
                        {audit.signals.hasProductSchema ? 'Product schema' : audit.signals.hasSchema ? 'Schema present' : 'No schema'}
                      </div>
                    </>
                  )}
                  {audit.indexDiagnosis && (
                    <div className="text-sm text-[#6B6B6B]">
                      HTTP {audit.httpStatus}
                      {audit.signals.wordCount < 40 && (
                        <span className="text-amber-800">
                          {' '}
                          · {audit.signals.wordCount} words in initial HTML (likely JS-rendered shell — not representative of{' '}
                          {audit.indexDiagnosis.coverage.fetchedCount} crawled site pages)
                        </span>
                      )}
                    </div>
                  )}
                </div>
                {!audit.indexDiagnosis && audit.siteType.signals.length > 0 && (
                  <p className="text-xs text-[#9B9B9B] mt-2">Signals: {audit.siteType.signals.join(', ')}</p>
                )}
                {audit.crawlNotes
                  .filter((n) => !audit.indexDiagnosis || !/SPA|Index Diagnosis skipped/i.test(n))
                  .map((n) => (
                    <p key={n} className="text-xs text-amber-700 mt-1">{n}</p>
                  ))}
              </div>

              {/* Connection gate — Fix Agent only when owned + connected */}
              <div className="border border-[#E5E5E5] rounded-xl p-4 bg-white">
                <h2 className="font-medium mb-2">Site connection</h2>
                {connection?.connected ? (
                  <div className="space-y-3">
                    <p className="text-sm text-[#6B6B6B]">
                      Connected as <span className="text-[#0F0F0F] font-medium">{connection.domain}</span>
                      {connection.cmsType ? ` via ${connection.cmsType}` : ''}.
                    </p>
                    {connection.fixableScope && (
                      <p className="text-sm text-[#0F0F0F]">{connection.fixableScope}</p>
                    )}
                    {connection.isUniversalTag && (
                      <p className="text-xs text-amber-800 bg-amber-50 rounded px-2 py-1.5">
                        Universal Tag cannot set HTTP security headers (they are sent before any JavaScript runs). Connect WordPress, Shopify, or GitHub to auto-fix headers.
                      </p>
                    )}
                    <button
                      onClick={() => void runFixAgent()}
                      disabled={fixRunning}
                      className="px-4 py-2 rounded-lg bg-[#0F0F0F] text-white disabled:opacity-50"
                    >
                      {fixRunning ? 'Fix Agent running…' : 'Run Fix Agent'}
                    </button>
                    <p className="text-xs text-[#9B9B9B]">
                      One site per action. Every change is logged with before/after and can be reverted. Thin content and linking issues become human tasks.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-2">
                    <p className="text-sm text-[#6B6B6B]">
                      {connection?.prompt ||
                        'This URL is not linked to an active site connection. You can view the audit report below — auto-fix is unavailable.'}
                    </p>
                    {connection?.needsExactSiteRegistration && connection.suggestedDomain ? (
                      <p className="text-sm text-amber-900 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
                        This fix requires connecting{' '}
                        <span className="font-medium">{connection.suggestedDomain}</span> — go to
                        Settings to connect it
                        {connection.parentDomain
                          ? ` (separate from ${connection.parentDomain}; a GSC property list does not grant write access)`
                          : ''}
                        .
                      </p>
                    ) : null}
                    <Link href="/dashboard/settings" className="text-sm text-[#FF6B2C] underline">
                      {connection?.needsExactSiteRegistration
                        ? 'Add this host in Settings → Your Sites'
                        : 'Connect your site in Settings → Your Sites'}
                    </Link>
                  </div>
                )}
                {persistenceWarning && (
                  <div className="border border-amber-300 bg-amber-50 text-amber-950 rounded-lg px-3 py-2 text-sm mt-3">
                    Persistence warning: {persistenceWarning}
                  </div>
                )}

                {cspProposal && cspProposal.status === 'pending_approval' && connection?.siteId && (
                  <div className="border border-sky-200 bg-sky-50 text-sky-950 rounded-lg px-3 py-3 text-sm mt-3 space-y-2">
                    <div className="font-medium">CSP report-only — approval required</div>
                    <p>{cspProposal.message}</p>
                    <pre className="text-xs whitespace-pre-wrap break-all bg-white border border-sky-100 rounded p-2 max-h-40 overflow-auto">
                      {cspProposal.policyHeader}
                    </pre>
                    <p className="text-xs text-sky-900/80">
                      Origins: {cspProposal.origins.join(', ') || '—'}
                    </p>
                    <button
                      type="button"
                      disabled={cspBusy}
                      className="px-3 py-1.5 rounded-lg bg-[#0F0F0F] text-white text-sm disabled:opacity-50"
                      onClick={() => {
                        void (async () => {
                          if (!connection.siteId) return
                          setCspBusy(true)
                          try {
                            const res = await fetch('/api/copilot/csp', {
                              method: 'POST',
                              headers: { 'Content-Type': 'application/json' },
                              body: JSON.stringify({
                                siteId: connection.siteId,
                                action: 'approve_report_only',
                              }),
                            })
                            const data = await res.json()
                            if (!res.ok) throw new Error(data.error || 'CSP approve failed')
                            setCspProposal({
                              ...cspProposal,
                              status: 'report_only',
                              message: data.message || 'Report-only CSP shipped.',
                            })
                            setFixMessage(data.message || 'Report-only CSP shipped.')
                          } catch (err) {
                            setError(err instanceof Error ? err.message : 'CSP approve failed')
                          } finally {
                            setCspBusy(false)
                          }
                        })()
                      }}
                    >
                      {cspBusy ? 'Shipping…' : 'Approve & ship report-only CSP'}
                    </button>
                  </div>
                )}

                {fixMessage && (
                  <div
                    id="fix-agent-summary"
                    className={`text-sm mt-3 rounded-lg px-3 py-2 border ${
                      /failed \(see errors\)/i.test(fixMessage)
                        ? 'border-red-200 bg-red-50 text-red-900'
                        : /awaiting Vercel|awaiting merge|PR\(s\)/i.test(fixMessage)
                          ? 'border-sky-200 bg-sky-50 text-sky-900'
                          : 'border-[#E5E5E5] bg-white text-[#0F0F0F]'
                    }`}
                  >
                    <div>{fixMessage}</div>
                    {failedAttempts.length > 0 && (
                      <button
                        type="button"
                        className="text-xs underline mt-1 text-red-800"
                        onClick={() => {
                          setFailedAttemptsOpen(true)
                          document
                            .getElementById('fix-agent-failed-attempts')
                            ?.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
                        }}
                      >
                        View {failedAttempts.length} failed attempt
                        {failedAttempts.length === 1 ? '' : 's'} below
                      </button>
                    )}
                  </div>
                )}

                {failedAttempts.length > 0 && (
                  <details
                    id="fix-agent-failed-attempts"
                    className="mt-3 rounded-lg border border-red-200 bg-red-50"
                    open={failedAttemptsOpen}
                    onToggle={(e) => setFailedAttemptsOpen((e.target as HTMLDetailsElement).open)}
                  >
                    <summary className="cursor-pointer select-none px-3 py-2 font-medium text-red-900">
                      Failed attempts ({failedAttempts.length})
                      <span className="font-normal text-red-800/80 text-xs ml-2">
                        — expand for issue, error, and GitHub write path
                      </span>
                    </summary>
                    <ul className="space-y-2 px-3 pb-3">
                      {failedAttempts.map((a) => {
                        const title = a.issueTitle || a.issue_title || a.issueId || a.issue_id || 'Unknown issue'
                        const err = attemptErrorText(a)
                        const writePath = attemptWritePathLabel(a)
                        const strategy = a.strategy || 'unknown'
                        const kind = a.autoKind || a.auto_kind || ''
                        return (
                          <li
                            key={`failed-${a.id || title}-${strategy}-${a.attemptNumber || a.attempt_number}`}
                            className="border border-red-200 rounded-lg px-3 py-2 bg-white text-sm"
                          >
                            <div className="text-xs uppercase tracking-wide text-red-800">
                              {kind || 'auto-fix'} · {formatAttemptStatus(a.status)}
                            </div>
                            <div className="font-medium text-[#0F0F0F] mt-0.5">{title}</div>
                            {(a.targetUrl || a.target_url) && (
                              <div className="text-xs text-[#6B6B6B] mt-1 break-all">
                                URL: {a.targetUrl || a.target_url}
                              </div>
                            )}
                            <div className="text-xs text-[#6B6B6B] mt-1">
                              Write path: <span className="text-[#0F0F0F]">{writePath}</span>
                              {strategy ? ` · strategy: ${strategy}` : ''}
                              {(a.issueKey || a.issue_key) ? ` · key: ${a.issueKey || a.issue_key}` : ''}
                            </div>
                            {err && (
                              <div className="text-sm text-red-800 mt-2 whitespace-pre-wrap break-words">
                                <span className="font-medium">Error: </span>
                                {err}
                              </div>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </details>
                )}
              </div>

              <div>
                <h2 className="font-medium mb-1">Dimensions</h2>
                {audit.indexDiagnosis && (
                  <p className="text-xs text-[#9B9B9B] mb-2">
                    Per-page Quality Gate on the scanned URL only. Technical SEO, structured data, and editorial checks
                    below do not summarise the {audit.indexDiagnosis.coverage.fetchedCount}-page crawl — use Index
                    Diagnosis above for site-wide indexability.
                  </p>
                )}
                <div className="grid gap-2">
                  {audit.explainable.dimensions.map((d) => (
                    <div key={d.id} className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white flex justify-between gap-4">
                      <div>
                        <div className="font-medium">{d.label}</div>
                        <div className="text-xs text-[#6B6B6B]">{d.summary}</div>
                        {d.id === 'core_web_vitals' && cwvLoading && (
                          <div className="text-xs text-[#9B9B9B] mt-1">Loading PageSpeed Insights…</div>
                        )}
                        {d.id === 'core_web_vitals' && audit.coreWebVitals?.metrics && audit.coreWebVitals.metrics.length > 0 && (
                          <div className="text-xs text-[#0F0F0F] mt-1">
                            {audit.coreWebVitals.metrics
                              .map((m) => `${m.label} ${m.displayValue} (${m.rating.replace(/_/g, ' ')}, ${m.source})`)
                              .join(' · ')}
                            {audit.coreWebVitals.labFallbackUsed
                              ? ' · lab data only — insufficient real-user traffic for field data'
                              : ''}
                          </div>
                        )}
                      </div>
                      <div
                        className={`text-sm font-medium ${
                          d.status === 'FAIL'
                            ? 'text-red-600'
                            : d.status === 'REVIEW'
                              ? 'text-amber-600'
                              : d.status === 'ADVISORY'
                                ? 'text-[#6B6B6B]'
                                : 'text-green-700'
                        }`}
                      >
                        {d.status}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-[#9B9B9B] mt-2">{audit.explainable.scoreExplanation}</p>
                <p className="text-sm mt-1">Next: {audit.explainable.publishDecisionReason}</p>
              </div>

              <div>
                <h2 className="font-medium mb-2">
                  Issues ({audit.issues.length})
                  {audit.auditScope && (
                    <span className="text-xs font-normal text-[#9B9B9B] ml-2">
                      — page-level checks on scanned URL; site-wide indexability checked across{' '}
                      {audit.auditScope.urlsFetched} crawled / {audit.auditScope.urlsDiscovered} discovered URLs
                    </span>
                  )}
                </h2>
                {audit.issues.length === 0 && audit.auditScope && (
                  <p className="text-sm text-[#6B6B6B] mb-2">
                    No issues on the scanned URL. Index diagnosis analysed {audit.auditScope.urlsFetched} fetched URLs
                    (of {audit.auditScope.urlsDiscovered} discovered).
                  </p>
                )}
                <ul className="space-y-2">
                  {audit.issues.slice(0, 40).map((issue) => {
                    const fixability = classifyClientSide(issue, connection?.cmsType)
                    return (
                      <li key={issue.id} className="border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white">
                        <div className="flex flex-wrap gap-2 items-center text-xs uppercase tracking-wide text-[#9B9B9B]">
                          <span>{issue.severity} · {issue.category}</span>
                          {fixability.label === 'auto' && (
                            <span className="normal-case tracking-normal text-green-800 bg-green-50 px-1.5 py-0.5 rounded">
                              Auto-fixable
                            </span>
                          )}
                          {fixability.label === 'server' && (
                            <span className="normal-case tracking-normal text-blue-800 bg-blue-50 px-1.5 py-0.5 rounded">
                              Needs server/CMS
                            </span>
                          )}
                          {fixability.label === 'human' && (
                            <span className="normal-case tracking-normal text-amber-800 bg-amber-50 px-1.5 py-0.5 rounded">
                              Human / brief
                            </span>
                          )}
                        </div>
                        <div className="font-medium">{issue.title}</div>
                        <div className="text-sm text-[#6B6B6B]">{issue.description}</div>
                        {(fixability.hint || issue.remediation) && (
                          <div className="text-sm mt-1 text-[#0F0F0F]">
                            What to do: {fixability.hint || issue.remediation}
                          </div>
                        )}
                        <AuditPasteFix issueTitle={issue.title} issueDescription={issue.description} />
                      </li>
                    )
                  })}
                </ul>
              </div>

              {humanTasks.length > 0 && (
                <div>
                  <h2 className="font-medium mb-2">Human tasks from Fix Agent</h2>
                  <p className="text-xs text-[#6B6B6B] mb-2">
                    These need editorial work — they are separate from commits awaiting deploy or PR merge.
                  </p>
                  <ul className="space-y-2">
                    {humanTasks.map((t) => (
                      <li key={`${t.kind}-${t.title}`} className="border border-amber-200 rounded-lg px-3 py-2 bg-amber-50">
                        <div className="text-xs uppercase text-amber-800">{t.kind}</div>
                        <div className="font-medium">{t.title}</div>
                        <div className="text-sm text-[#6B6B6B]">{t.reason}</div>
                        <div className="text-sm mt-1">{t.suggestedAction}</div>
                        {t.kind === 'thin-content' && (
                          <Link href="/dashboard/briefs" className="text-sm text-[#FF6B2C] underline mt-1 inline-block">
                            Open Keyword Briefs
                          </Link>
                        )}
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {attempts.length > 0 && (
                <div>
                  <h2 className="font-medium mb-2">Fix Agent log</h2>
                  <ul className="space-y-2">
                    {attempts.slice(0, 30).map((a) => {
                      const id = a.id
                      const title = a.issueTitle || a.issue_title || a.issueId || a.issue_id
                      const summary = a.diffSummary || a.diff_summary
                      const err = a.errorMessage || a.error_message
                      const detail = a.verificationDetail || a.verification_detail
                      const status = a.status || ''
                      const isFailed = status === 'failed' || status === 'handed_off'
                      const isPending =
                        status === 'pending_deploy' ||
                        status === 'pending_merge' ||
                        status === 'unverified' ||
                        status === 'pr_pending' ||
                        status === 'applied' ||
                        a.pendingKind === 'deploy' ||
                        a.pendingKind === 'merge'
                      const prUrl = a.pendingUrl || extractPrUrl(detail) || extractPrUrl(summary)
                      return (
                        <li
                          key={`${id}-${a.strategy}-${a.attemptNumber || a.attempt_number}`}
                          className={`border rounded-lg px-3 py-2 text-sm ${
                            isFailed
                              ? 'border-red-200 bg-red-50'
                              : isPending
                                ? 'border-sky-200 bg-sky-50'
                                : 'border-[#E5E5E5] bg-white'
                          }`}
                        >
                          <div className="flex justify-between gap-2">
                            <div>
                              <span className="font-medium">{title}</span>
                              <span className="text-[#9B9B9B]">
                                {' '}
                                · {a.autoKind || a.auto_kind} · {a.strategy} · {formatAttemptStatus(status)}
                              </span>
                            </div>
                            {a.revertible && !status.includes('revert') && (
                              <button
                                type="button"
                                disabled={fixRunning}
                                onClick={() => revertAttempt(id)}
                                className="text-xs underline text-[#6B6B6B] shrink-0"
                              >
                                Revert
                              </button>
                            )}
                          </div>
                          {summary && <div className="text-[#6B6B6B] mt-1">{summary}</div>}
                          {err && (
                            <div className="text-xs text-red-700 mt-1 font-medium">
                              Error: {err}
                            </div>
                          )}
                          {detail && detail !== err && (
                            <div className="text-xs text-[#6B6B6B] mt-0.5">{detail}</div>
                          )}
                          {prUrl && (
                            <a
                              href={prUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="text-xs text-[#FF6B2C] underline mt-1 inline-block"
                            >
                              Open pull request
                            </a>
                          )}
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )}

              {audit.history.length > 0 && (
                <div>
                  <h2 className="font-medium mb-2">Score history</h2>
                  <ul className="text-sm text-[#6B6B6B] space-y-1">
                    {audit.history.map((h) => (
                      <li key={h.auditedAt}>
                        {new Date(h.auditedAt).toLocaleString()} — {h.score}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
