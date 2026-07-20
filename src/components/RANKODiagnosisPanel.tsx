'use client'
import { useState } from 'react'

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
function IconEye({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
      <circle cx="12" cy="12" r="3"/>
    </svg>
  )
}

export function RANKODiagnosisPanel({ siteUrl }: Props) {
  const [loading, setLoading] = useState(false)
  const [diagnosis, setDiagnosis] = useState<RANKODiagnosis | null>(null)
  const [expandedIssue, setExpandedIssue] = useState<string | null>(null)

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
    </div>
  )
}
