'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { DashboardNav } from '@/components/DashboardNav'
import { BetaOnboardingChecklist } from '@/components/BetaOnboardingChecklist'
import { IndexDiagnosisPanel } from '@/components/IndexDiagnosisPanel'
import { LinkGraphPanel } from '@/components/LinkGraphPanel'
import type { IndexDiagnosisResult } from '@/lib/index-diagnosis/types'

import { DIAGNOSTICS_COPY } from '@/lib/diagnostics-copy'

interface AuditResult {
  url: string
  crawlNotes: string[]
  indexDiagnosis?: IndexDiagnosisResult | null
  indexDiagnosisRunId?: string | null
  indexDiagnosisPersistOk?: boolean
  indexDiagnosisPersistError?: string | null
  /** True when panels were restored from DB without a fresh crawl. */
  restoredFromSaved?: boolean
}

interface ConnectionStatus {
  connected: boolean
  siteId?: string
  domain?: string
  brand?: string
  cmsType?: string
  prompt?: string
  needsExactSiteRegistration?: boolean
  suggestedDomain?: string
  parentDomain?: string
}

export default function AuditPage() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [audit, setAudit] = useState<AuditResult | null>(null)
  const [connection, setConnection] = useState<ConnectionStatus | null>(null)
  const [persistenceWarning, setPersistenceWarning] = useState<string | null>(null)
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

      if (hydrateDiagnosis && data.needsFreshCrawl) {
        setSavedLinkGraph(null)
        setSavedMeta(data.needsFreshCrawlReason || 'Stored audit is incomplete — scanning fresh…')
        setUrl((prev) => prev || domainOrUrl)
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
              if (!scanRes.ok) throw new Error(scanData.error || 'Scan failed')
              setAudit({
                url: scanData.audit.url,
                crawlNotes: scanData.audit.crawlNotes || [],
                indexDiagnosis: scanData.audit.indexDiagnosis,
                indexDiagnosisRunId: scanData.audit.indexDiagnosisRunId,
                indexDiagnosisPersistOk: scanData.audit.indexDiagnosisPersistOk,
                indexDiagnosisPersistError: scanData.audit.indexDiagnosisPersistError,
              })
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
            } catch (err) {
              setError(err instanceof Error ? err.message : 'Scan failed')
            } finally {
              setLoading(false)
            }
          })()
        })
        return
      }

      if (data.linkGraph?.auditId) {
        setSavedLinkGraph({
          auditId: data.linkGraph.auditId,
          createdAt: data.linkGraph.createdAt,
          summary: data.linkGraph.summary,
          topFindings: data.linkGraph.topFindings || [],
        })
      }

      if (!hydrateDiagnosis || !data.indexDiagnosis) return

      setSavedMeta(
        data.indexDiagnosisCreatedAt
          ? `Showing saved Index Diagnosis from ${new Date(data.indexDiagnosisCreatedAt).toLocaleString()}. Scan to refresh.`
          : 'Showing saved Index Diagnosis. Scan to refresh.',
      )
      setAudit((prev) => {
        if (prev && !prev.restoredFromSaved) {
          if (prev.indexDiagnosis) return prev
          return {
            ...prev,
            indexDiagnosis: data.indexDiagnosis,
            indexDiagnosisRunId: data.indexDiagnosisRunId,
          }
        }
        return {
          url: data.pageAudit?.url || data.indexDiagnosis.coverage.seedUrl || domainOrUrl,
          crawlNotes: ['Restored last saved Index Diagnosis from the database (no re-crawl).'],
          indexDiagnosis: data.indexDiagnosis,
          indexDiagnosisRunId: data.indexDiagnosisRunId,
          restoredFromSaved: true,
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

  useEffect(() => {
    if (!audit?.url) return
    void refreshConnection(audit.url)
  }, [audit?.url, refreshConnection])

  async function runAudit() {
    setLoading(true)
    setError(null)
    setConnection(null)
    try {
      const res = await fetch('/api/copilot/audit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Scan failed')
      setAudit({
        url: data.audit.url,
        crawlNotes: data.audit.crawlNotes || [],
        indexDiagnosis: data.audit.indexDiagnosis,
        indexDiagnosisRunId: data.audit.indexDiagnosisRunId,
        indexDiagnosisPersistOk: data.audit.indexDiagnosisPersistOk,
        indexDiagnosisPersistError: data.audit.indexDiagnosisPersistError,
      })
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
      if (data.audit?.indexDiagnosis?.coverage?.domain) {
        void loadSavedAudits(data.audit.indexDiagnosis.coverage.domain, { hydrateDiagnosis: false })
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Scan failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div
      className="flex h-screen bg-[#FAFAF8] text-[#0F0F0F] overflow-hidden"
      style={{ fontFamily: "'Outfit', sans-serif", fontSize: '15px' }}
    >
      <DashboardNav />
      <main className="flex-1 overflow-y-auto">
        <div className="max-w-3xl mx-auto px-8 py-8">
          <h1 className="text-2xl font-semibold mb-2">{DIAGNOSTICS_COPY.title}</h1>
          <p className="text-[#6B6B6B] mb-4">{DIAGNOSTICS_COPY.intro}</p>
          <div className="mb-6">
            <Link
              href="/dashboard/findings"
              className="inline-flex px-4 py-2 rounded-lg bg-[#FF6B2C] text-white text-sm font-medium hover:bg-[#E85A1E] transition-colors"
            >
              {DIAGNOSTICS_COPY.openAuditCta}
            </Link>
          </div>

          <div className="mb-6">
            <BetaOnboardingChecklist compact />
          </div>

          <div className="flex gap-2 mb-6">
            <input
              className="flex-1 border border-[#E5E5E5] rounded-lg px-3 py-2 bg-white"
              placeholder={DIAGNOSTICS_COPY.scanPlaceholder}
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
            <button
              onClick={() => void runAudit()}
              disabled={loading || !url.trim()}
              className="px-4 py-2 rounded-lg bg-[#FF6B2C] text-white disabled:opacity-50"
            >
              {loading ? DIAGNOSTICS_COPY.scanningLabel : DIAGNOSTICS_COPY.scanLabel}
            </button>
          </div>

          {error && <p className="text-red-600 mb-4">{error}</p>}
          {savedMeta && <p className="text-sm text-[#6B6B6B] mb-4">{savedMeta}</p>}
          {persistenceWarning && (
            <div className="border border-amber-300 bg-amber-50 text-amber-950 rounded-lg px-3 py-2 text-sm mb-4">
              Persistence warning: {persistenceWarning}
            </div>
          )}

          {audit && (
            <div className="space-y-6">
              {audit.indexDiagnosis && (
                <IndexDiagnosisPanel
                  data={audit.indexDiagnosis}
                  siteId={connection?.siteId}
                  cmsConnected={connection?.connected}
                  connectedPlatform={connection?.cmsType}
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
                            'Connect this site in Settings → Your Sites to apply fixes from Audit.',
                        }
                  }
                />
              )}

              {!audit.indexDiagnosis && (
                <p className="text-sm text-[#6B6B6B]">{DIAGNOSTICS_COPY.emptyDiagnosis}</p>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
