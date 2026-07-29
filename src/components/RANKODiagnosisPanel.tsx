'use client'
import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase-client'
import { resolveArticle, isWritable, EXTERNAL_NOT_WRITABLE_MESSAGE } from '@/lib/article-resolver'
import type { SiteFixType } from '@/lib/site-autofix'
import { ConnectSiteModal } from '@/components/ConnectSiteModal'

interface RANKOIssue {
  id: string
  category: string
  impact: 'critical' | 'high' | 'medium' | 'low'
  title: string
  whyItHurts: string
  fix: string
  confidence: number
  risk: string
  autoFixable: boolean
  estimatedGain: string
  affectedItems?: string[]
  affectedArticleIds?: string[]
}

interface RANKODiagnosis {
  siteUrl: string
  diagnosedAt: string
  overallHealth: string
  healthScore: number
  issues: RANKOIssue[]
  priorityQueue: string[]
  doNothing: string[]
  topThreeActions: string[]
  estimatedWeeksToImpact: number
}

interface Props {
  userId: string
  siteUrl: string
  /** connected_sites.id — enables real one-click fixes on the live site. */
  siteId?: string
}

// Map a RANKO issue to a WordPress fix we can actually perform.
// Anything not listed here has no automated site-level fix.
function siteFixTypeFor(issue: { id: string; category: string; title: string }): SiteFixType | null {
  const haystack = `${issue.id} ${issue.title}`.toLowerCase()
  if (haystack.includes('organization') || haystack.includes('organisation')) return 'schema-org-inject'
  if (haystack.includes('schema')) return 'schema-article-inject'
  if (haystack.includes('author') || haystack.includes('byline')) return 'author-bio-visible'
  return null
}

// Inline SVG icons (lucide-react not installed)
function IconBrain({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9.5 2A2.5 2.5 0 0 1 12 4.5v15a2.5 2.5 0 0 1-4.96-.46 2.5 2.5 0 0 1-1.96-3 2.5 2.5 0 0 1 .3-4.97A2.5 2.5 0 0 1 9.5 2z"/>
      <path d="M14.5 2A2.5 2.5 0 0 0 12 4.5v15a2.5 2.5 0 0 0 4.96-.46 2.5 2.5 0 0 0 1.96-3 2.5 2.5 0 0 0-.3-4.97A2.5 2.5 0 0 0 14.5 2z"/>
    </svg>
  )
}
function IconLoader({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="12" y1="2" x2="12" y2="6"/><line x1="12" y1="18" x2="12" y2="22"/>
      <line x1="4.93" y1="4.93" x2="7.76" y2="7.76"/><line x1="16.24" y1="16.24" x2="19.07" y2="19.07"/>
      <line x1="2" y1="12" x2="6" y2="12"/><line x1="18" y1="12" x2="22" y2="12"/>
      <line x1="4.93" y1="19.07" x2="7.76" y2="16.24"/><line x1="16.24" y1="7.76" x2="19.07" y2="4.93"/>
    </svg>
  )
}
function IconShield({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>
    </svg>
  )
}
function IconTarget({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  )
}
function IconCheckCircle({ className }: { className?: string }) {
  return (
    <svg className={className} fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <circle cx="12" cy="12" r="10" strokeWidth={2} />
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4" />
    </svg>
  )
}

function IconEye({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

export function RANKODiagnosisPanel({ siteUrl, siteId }: Props) {
  const router = useRouter()
  const [loading, setLoading] = useState(false)
  const [diagnosis, setDiagnosis] = useState<RANKODiagnosis | null>(null)
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null)
  const [fixingId, setFixingId] = useState<string | null>(null)
  const [fixedIds, setFixedIds] = useState<Record<string, string>>({})
  const [fixErrors, setFixErrors] = useState<Record<string, string>>({})
  const [fixUnavailable, setFixUnavailable] = useState<Record<string, boolean>>({})
  const [wpConnected, setWpConnected] = useState<boolean | null>(null)
  const [tagToken, setTagToken] = useState<string | null>(null)
  const [showConnectModal, setShowConnectModal] = useState(false)

  const domain = siteUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '')

  // Is this site connected to a CMS? Determines whether a site-level issue
  // offers "Fix automatically" or "Connect & fix".
  async function refreshConnection() {
    if (!siteId) { setWpConnected(false); return }

    const [{ data: conn }, { data: site }] = await Promise.all([
      supabase
        .from('site_connections')
        .select('site_id')
        .eq('site_id', siteId)
        .eq('is_active', true)
        .maybeSingle(),
      // Needed for the Universal Tag snippet if this site isn't WP/Shopify/Webflow
      supabase
        .from('connected_sites')
        .select('universal_tag_token')
        .eq('id', siteId)
        .maybeSingle()
    ])

    setWpConnected(Boolean(conn))
    setTagToken((site as { universal_tag_token?: string } | null)?.universal_tag_token ?? null)
  }

  useEffect(() => {
    refreshConnection()
  }, [siteId]) // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Site-level issues have no article to improve. If the site isn't connected
   * yet, open the Connect Site modal in place rather than navigating away to
   * the Article Improver — which is what the button used to do.
   */
  function handleSiteFixClick(issue: RANKOIssue) {
    if (!wpConnected) {
      setShowConnectModal(true)
      return
    }
    handleApplySiteFix(issue)
  }

  async function handleApplySiteFix(issue: RANKOIssue) {
    const fixType = siteFixTypeFor(issue)
    if (!siteId || !fixType) return

    setFixingId(issue.id)
    setFixErrors(prev => { const next = { ...prev }; delete next[issue.id]; return next })

    try {
      const res = await fetch('/api/ranko/apply-site-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteId, issueId: issue.id, fixType, targetUrl: siteUrl })
      })
      const data = await res.json()

      if (!data.success) {
        setFixErrors(prev => ({ ...prev, [issue.id]: data.message || 'Could not apply this fix.' }))
        return
      }

      setFixedIds(prev => ({
        ...prev,
        [issue.id]: data.verified
          ? `✓ Applied and verified — ${data.message}`
          : `Applied, verification pending — ${data.message}`
      }))

      if (data.verified) setTimeout(() => { runDiagnosis() }, 2000)
    } catch {
      setFixErrors(prev => ({ ...prev, [issue.id]: 'Could not apply this fix — try again.' }))
    } finally {
      setFixingId(null)
    }
  }

  // RANKO acts on its own only when the diagnosis says it may. `autoFixable` is
  // the engine's explicit act/propose flag — note it is NOT the same as low risk
  // (e.g. "stuck articles" is low-risk but deliberately not auto-fixable).
  const canAutoFix = (issue: RANKOIssue) =>
    issue.autoFixable && (issue.affectedArticleIds?.length ?? 0) > 0

  async function handleAutoFix(issue: RANKOIssue) {
    const articleId = issue.affectedArticleIds?.[0]
    if (!articleId) return

    setFixingId(issue.id)
    setFixErrors(prev => { const next = { ...prev }; delete next[issue.id]; return next })

    try {
      // Universal resolver — the id may be a local article or a tracked URL.
      const resolved = await resolveArticle(supabase, articleId)

      if (!resolved.content) {
        setFixErrors(prev => ({ ...prev, [issue.id]: resolved.fetchError || 'Could not load this article.' }))
        setFixUnavailable(prev => ({ ...prev, [issue.id]: true }))
        return
      }

      // Fetched-live content has no row to write back to — don't generate a
      // fix and silently discard it.
      if (!isWritable(resolved)) {
        setFixErrors(prev => ({ ...prev, [issue.id]: EXTERNAL_NOT_WRITABLE_MESSAGE }))
        setFixUnavailable(prev => ({ ...prev, [issue.id]: true }))
        return
      }

      const res = await fetch('/api/improve-article', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          articleId,
          articleContent: resolved.content,
          title: resolved.title,
          keyword: resolved.keyword,
          instruction: issue.fix,
          autoApply: true
        })
      })
      const data = await res.json()

      // Identity guard rejected the result — surface why, don't claim success.
      if (data.blocked) {
        setFixErrors(prev => ({ ...prev, [issue.id]: data.warning || 'Fix blocked — the result did not match the original article.' }))
        setFixUnavailable(prev => ({ ...prev, [issue.id]: true }))
        return
      }

      if (!res.ok || !data.success) {
        setFixErrors(prev => ({ ...prev, [issue.id]: data.error || 'Fix failed' }))
        return
      }

      setFixedIds(prev => ({
        ...prev,
        [issue.id]: data.changesSummary || 'Fix applied'
      }))

      // Re-diagnose so the health score visibly reflects the fix
      setTimeout(() => { runDiagnosis() }, 2000)
    } catch (err) {
      console.error('Auto-fix failed:', err)
      setFixErrors(prev => ({ ...prev, [issue.id]: String(err) }))
    } finally {
      setFixingId(null)
    }
  }

  function handleReviewFix(issue: RANKOIssue) {
    const articleId = issue.affectedArticleIds?.[0]
    const params = new URLSearchParams({ tab: 'improve', instruction: issue.fix })
    if (articleId) params.set('articleId', articleId)
    router.push(`/dashboard/optimise?${params.toString()}`)
  }

  async function runDiagnosis() {
    setLoading(true)
    try {
      const res = await fetch('/api/ranko/diagnose', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ siteUrl })
      })
      const data = await res.json()
      if (data.diagnosis) setDiagnosis(data.diagnosis)
    } catch (err) {
      console.error('RANKO diagnosis failed:', err)
    } finally {
      setLoading(false)
    }
  }

  // Action buttons for a single issue — act (auto-fix) vs propose (review).
  function IssueActions({ issue }: { issue: RANKOIssue }) {
    if (fixedIds[issue.id]) {
      return (
        <div className="flex items-center gap-2 text-xs text-green-700 bg-green-50 border border-green-200 px-3 py-2 rounded-lg">
          <IconCheckCircle className="w-4 h-4 flex-shrink-0" />
          <span>Fixed — re-checking your score…</span>
        </div>
      )
    }

    const autoFix = canAutoFix(issue)
    const noArticle = (issue.affectedArticleIds?.length ?? 0) === 0
    // Site-level issue we can genuinely fix on the live site
    const siteFix = noArticle ? siteFixTypeFor(issue) : null
    const isSiteLevelFix = Boolean(siteFix && siteId)

    return (
      <div className="space-y-2">
        <div className="flex gap-2 flex-wrap">
          {isSiteLevelFix ? (
            // Site-level issue: connect the site or apply the fix to it.
            // Never route these to the Article Improver — there is no article.
            <button
              onClick={() => handleSiteFixClick(issue)}
              disabled={fixingId === issue.id}
              className="text-xs font-medium bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {fixingId === issue.id
                ? 'Applying to your site…'
                : wpConnected ? '⚡ Fix automatically' : 'Connect & fix'}
            </button>
          ) : fixUnavailable[issue.id] ? (
            // Auto-fix couldn't run — never leave the user stuck
            <button
              onClick={() => handleReviewFix(issue)}
              className="text-xs font-medium bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg transition-colors"
            >
              Open in Improve →
            </button>
          ) : autoFix ? (
            <button
              onClick={() => handleAutoFix(issue)}
              disabled={fixingId === issue.id}
              className="text-xs font-medium bg-orange-500 hover:bg-orange-600 text-white px-3 py-1.5 rounded-lg disabled:opacity-50 transition-colors"
            >
              {fixingId === issue.id ? 'Fixing…' : '⚡ Fix automatically'}
            </button>
          ) : noArticle ? (
            // Site-level issue with no automated fix — there is no article to
            // improve, so don't offer a button that navigates to the Improver.
            null
          ) : (
            <button
              onClick={() => handleReviewFix(issue)}
              className="text-xs font-medium bg-white border border-gray-300 text-gray-700 px-3 py-1.5 rounded-lg hover:border-gray-400 transition-colors"
            >
              👁 Review &amp; apply
            </button>
          )}
        </div>

        {isSiteLevelFix && wpConnected && (
          <p className="text-xs text-gray-400">
            Writes directly to your live site, then re-checks the page to confirm.
          </p>
        )}
        {isSiteLevelFix && wpConnected === false && (
          <p className="text-xs text-gray-400">
            {domain} isn&rsquo;t connected yet — we&rsquo;ll set that up first, then apply the fix.
          </p>
        )}
        {noArticle && !siteFix && (
          <p className="text-xs text-gray-400">
            Site-level fix with no automated path — apply this to your site directly.
            See &ldquo;How to fix&rdquo; above.
          </p>
        )}

        {fixErrors[issue.id] && (
          <p className="text-xs text-red-600 bg-red-50 border border-red-200 px-3 py-2 rounded-lg break-words">
            {fixErrors[issue.id]}
          </p>
        )}
      </div>
    )
  }

  const healthColor = (health: string) => ({
    excellent: '#1D9E75', good: '#2563EB',
    'needs-work': '#BA7517', critical: '#E24B4A'
  } as Record<string, string>)[health] || '#BA7517'

  const impactBadge = (impact: string) => {
    const styles: Record<string, string> = {
      critical: 'bg-red-100 text-red-700',
      high: 'bg-orange-100 text-orange-700',
      medium: 'bg-amber-100 text-amber-700',
      low: 'bg-gray-100 text-gray-600'
    }
    return styles[impact] || styles.low
  }

  const riskBadge = (risk: string) => {
    const styles: Record<string, string> = {
      safe: 'bg-green-100 text-green-700',
      'low-risk': 'bg-blue-100 text-blue-700',
      'medium-risk': 'bg-amber-100 text-amber-700',
      'high-risk': 'bg-red-100 text-red-700'
    }
    return styles[risk] || styles.safe
  }

  if (!diagnosis) {
    return (
      <div className="bg-white rounded-2xl border border-gray-200 p-6 text-center">
        <div className="w-12 h-12 bg-orange-500 rounded-xl flex items-center justify-center mx-auto mb-4">
          <IconBrain className="w-6 h-6 text-white" />
        </div>
        <h3 className="text-base font-semibold text-gray-900 mb-1">RANKO Diagnosis</h3>
        <p className="text-sm text-gray-500 mb-4 max-w-sm mx-auto">
          RANKO analyses your site, ranks issues by ROI impact, and tells you exactly what to fix first — and what to leave alone.
        </p>
        <button
          onClick={runDiagnosis}
          disabled={loading}
          className="flex items-center gap-2 mx-auto px-5 py-2.5 bg-orange-500 hover:bg-orange-600 text-white text-sm font-medium rounded-xl disabled:opacity-50 transition-colors"
        >
          {loading ? <IconLoader className="w-4 h-4 animate-spin" /> : <IconBrain className="w-4 h-4" />}
          {loading ? 'RANKO is diagnosing...' : 'Run RANKO diagnosis'}
        </button>
        {loading && (
          <p className="text-xs text-gray-400 mt-3">
            Analysing GEO signals · checking content quality · detecting conflicts · synthesising with Claude Sonnet...
          </p>
        )}
      </div>
    )
  }

  const color = healthColor(diagnosis.overallHealth)

  // Highest-impact issue: honour the engine's own priorityQueue, falling back to
  // critical-first then confidence when the queue is empty or stale.
  const IMPACT_ORDER: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
  const topIssue =
    diagnosis.issues.find(i => i.id === diagnosis.priorityQueue?.[0]) ??
    [...diagnosis.issues].sort(
      (a, b) =>
        (IMPACT_ORDER[a.impact] ?? 9) - (IMPACT_ORDER[b.impact] ?? 9) ||
        b.confidence - a.confidence
    )[0]

  return (
    <div className="space-y-4">
      {/* Health score */}
      <div className="bg-white rounded-2xl border-2 p-5" style={{ borderColor: color + '40' }}>
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-orange-500 rounded-xl flex items-center justify-center">
              <IconBrain className="w-5 h-5 text-white" />
            </div>
            <div>
              <p className="text-sm font-semibold text-gray-900">RANKO Diagnosis</p>
              <p className="text-xs text-gray-400">{diagnosis.siteUrl} · {new Date(diagnosis.diagnosedAt).toLocaleDateString('en-GB')}</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-4xl font-bold" style={{ color }}>{diagnosis.healthScore}</div>
            <div className="text-xs font-medium capitalize" style={{ color }}>{diagnosis.overallHealth.replace('-', ' ')}</div>
          </div>
        </div>
        <div className="w-full bg-gray-200 rounded-full h-2 mb-3">
          <div className="h-2 rounded-full transition-all" style={{ width: `${diagnosis.healthScore}%`, background: color }} />
        </div>
        <p className="text-xs text-gray-500">
          Expect meaningful rank movement in approximately <strong>{diagnosis.estimatedWeeksToImpact} weeks</strong> if you act on the priority fixes below.
        </p>
      </div>

      {/* Top priority — do this first */}
      {topIssue && (
        <div className="bg-orange-50 border-2 border-orange-200 rounded-xl p-4">
          <p className="text-xs font-semibold text-orange-700 mb-1">⭐ Do this first</p>
          <div className="flex items-center gap-2 flex-wrap mb-1">
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${impactBadge(topIssue.impact)}`}>
              {topIssue.impact}
            </span>
            <span className="text-xs text-gray-500">{topIssue.confidence}% confident</span>
          </div>
          <p className="text-sm font-medium text-gray-900 mb-1">{topIssue.title}</p>
          <p className="text-xs text-gray-600 mb-2">{topIssue.whyItHurts}</p>
          <p className="text-xs text-gray-500 mb-3">
            Expected gain: <span className="text-gray-700 font-medium">{topIssue.estimatedGain}</span>
          </p>
          <IssueActions issue={topIssue} />
        </div>
      )}

      {/* Top 3 actions */}
      <div className="bg-white rounded-xl border border-gray-200 p-4">
        <p className="text-sm font-semibold text-gray-800 mb-3 flex items-center gap-2">
          <IconTarget className="w-4 h-4 text-orange-500" />
          RANKO&rsquo;s top 3 actions — fix these first
        </p>
        <ol className="space-y-2">
          {diagnosis.topThreeActions.map((action, i) => (
            <li key={i} className="flex gap-2.5 text-sm text-gray-700">
              <span className="w-5 h-5 bg-orange-500 text-white rounded-full flex items-center justify-center text-xs font-bold flex-shrink-0 mt-0.5">
                {i + 1}
              </span>
              {action}
            </li>
          ))}
        </ol>
      </div>

      {/* Do not touch */}
      {diagnosis.doNothing.length > 0 && (
        <div className="bg-green-50 rounded-xl border border-green-200 p-4">
          <p className="text-sm font-semibold text-green-800 mb-2 flex items-center gap-2">
            <IconShield className="w-4 h-4" />
            Leave these alone — they&rsquo;re working
          </p>
          {diagnosis.doNothing.map((item, i) => (
            <p key={i} className="text-xs text-green-700">• {item}</p>
          ))}
        </div>
      )}

      {/* Issues list */}
      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-100">
          <p className="text-sm font-semibold text-gray-800">
            All issues ({diagnosis.issues.length}) — ranked by ROI
          </p>
        </div>
        <div className="divide-y divide-gray-100">
          {diagnosis.issues.map(issue => (
            <div key={issue.id} className="p-4">
              <button
                onClick={() => setExpandedIssue(expandedIssue === issue.id ? null : issue.id)}
                className="w-full text-left"
              >
                <div className="flex items-start gap-3">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 flex-wrap mb-1">
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${impactBadge(issue.impact)}`}>
                        {issue.impact}
                      </span>
                      <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${riskBadge(issue.risk)}`}>
                        {issue.risk}
                      </span>
                      {issue.autoFixable && (
                        <span className="text-xs px-2 py-0.5 rounded-full font-medium bg-purple-100 text-purple-700">
                          auto-fixable
                        </span>
                      )}
                      <span className="text-xs text-gray-400">{issue.confidence}% confident</span>
                    </div>
                    <p className="text-sm font-medium text-gray-900">{issue.title}</p>
                  </div>
                  <IconEye className="w-4 h-4 text-gray-400 flex-shrink-0 mt-0.5" />
                </div>
              </button>

              {expandedIssue === issue.id && (
                <div className="mt-3 space-y-3">
                  <div className="p-3 bg-red-50 rounded-lg border border-red-100">
                    <p className="text-xs font-medium text-red-700 mb-1">Why this hurts your rankings:</p>
                    <p className="text-xs text-red-600">{issue.whyItHurts}</p>
                  </div>
                  <div className="p-3 bg-blue-50 rounded-lg border border-blue-100">
                    <p className="text-xs font-medium text-blue-700 mb-1">
                      {issue.autoFixable ? '✦ RANKO can fix this automatically:' : 'How to fix:'}
                    </p>
                    <p className="text-xs text-blue-600">{issue.fix}</p>
                  </div>
                  <p className="text-xs text-gray-500">
                    Expected gain: <span className="text-gray-700 font-medium">{issue.estimatedGain}</span>
                  </p>
                  {issue.affectedItems && issue.affectedItems.length > 0 && (
                    <div>
                      <p className="text-xs text-gray-500 mb-1">Affected:</p>
                      {issue.affectedItems.slice(0, 3).map((item, i) => (
                        <p key={i} className="text-xs text-gray-600">• {item}</p>
                      ))}
                      {issue.affectedItems.length > 3 && (
                        <p className="text-xs text-gray-400">+{issue.affectedItems.length - 3} more</p>
                      )}
                    </div>
                  )}

                  <IssueActions issue={issue} />
                </div>
              )}

              {/* Fixed / error state stays visible when the row is collapsed */}
              {expandedIssue !== issue.id && (fixedIds[issue.id] || fixErrors[issue.id]) && (
                <div className="mt-3">
                  <IssueActions issue={issue} />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      {/* Re-diagnose */}
      <button
        onClick={runDiagnosis}
        disabled={loading}
        className="w-full flex items-center justify-center gap-2 text-sm text-gray-500 hover:text-orange-500 border border-gray-200 py-2 rounded-xl transition-colors"
      >
        <IconBrain className="w-4 h-4" />
        Re-run diagnosis
      </button>

      {showConnectModal && siteId && (
        <ConnectSiteModal
          siteId={siteId}
          domain={domain}
          universalTagToken={tagToken}
          onClose={() => setShowConnectModal(false)}
          onConnected={refreshConnection}
        />
      )}
    </div>
  )
}
