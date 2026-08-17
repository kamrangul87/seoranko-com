'use client'
import React, { useState } from 'react'

interface QualityIssue {
  id: string
  severity: 'critical' | 'warning' | 'info'
  category: string
  title: string
  description: string
  location?: string
  autoFixable: boolean
  autoFixDescription?: string
}

interface QualityGateResult {
  passed: boolean
  score: number
  criticalCount: number
  warningCount: number
  autoFixedCount: number
  issues: QualityIssue[]
  blockers: string[]
  readyToPublish: boolean
}

export interface FixAllReport {
  fixed: Array<{ id: string; title: string; how: string }>
  stillNeedsManualReview: Array<{ id: string; title: string; reason: string }>
  summary: string
  scoreBefore?: number
  scoreAfter?: number
}

interface QualityGatePanelProps {
  result: QualityGateResult
  onFixAll?: () => void
  fixAllRunning?: boolean
  fixAllReport?: FixAllReport | null
  /** @deprecated use onFixAll — kept for callers that only had single Auto-fix */
  onAutoFix?: () => void
  autoFixing?: boolean
}

function IconCheck({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" />
    </svg>
  )
}
function IconAlert({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
      <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
    </svg>
  )
}
function IconX({ className, style }: { className?: string; style?: React.CSSProperties }) {
  return (
    <svg className={className} style={style} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" /><line x1="15" y1="9" x2="9" y2="15" /><line x1="9" y1="9" x2="15" y2="15" />
    </svg>
  )
}
function IconWrench({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" />
    </svg>
  )
}
function IconChevronDown({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}
function IconChevronUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="18 15 12 9 6 15" />
    </svg>
  )
}

export function QualityGatePanel({
  result,
  onFixAll,
  fixAllRunning,
  fixAllReport,
  onAutoFix,
  autoFixing,
}: QualityGatePanelProps) {
  const [expanded, setExpanded] = useState(!result.readyToPublish)
  const runFix = onFixAll || onAutoFix
  const fixing = fixAllRunning || autoFixing
  const hasIssues = result.issues.length > 0 || result.criticalCount > 0 || result.warningCount > 0

  const statusColor = result.readyToPublish
    ? '#1D9E75'
    : result.criticalCount > 0
      ? '#E24B4A'
      : '#BA7517'

  const statusLabel = result.readyToPublish
    ? 'Ready to publish'
    : result.criticalCount > 0
      ? `${result.criticalCount} critical issue${result.criticalCount > 1 ? 's' : ''} — fix before publishing`
      : `${result.warningCount} warning${result.warningCount > 1 ? 's' : ''} — review before publishing`

  const severityIcon = (severity: string) => {
    if (severity === 'critical') return <IconX className="w-4 h-4 text-red-500 flex-shrink-0" />
    if (severity === 'warning') return <IconAlert className="w-4 h-4 text-amber-500 flex-shrink-0" />
    return <IconCheck className="w-4 h-4 text-blue-400 flex-shrink-0" />
  }

  const severityBg = (severity: string) => {
    if (severity === 'critical') return 'bg-red-50 border-red-200'
    if (severity === 'warning') return 'bg-amber-50 border-amber-200'
    return 'bg-blue-50 border-blue-100'
  }

  return (
    <div
      className="rounded-xl border-2 overflow-hidden mb-4"
      style={{ borderColor: statusColor + '40' }}
    >
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between p-4 text-left"
        style={{ background: statusColor + '10' }}
      >
        <div className="flex items-center gap-3">
          {result.readyToPublish
            ? <IconCheck className="w-5 h-5" style={{ color: statusColor }} />
            : result.criticalCount > 0
              ? <IconX className="w-5 h-5" style={{ color: statusColor }} />
              : <IconAlert className="w-5 h-5" style={{ color: statusColor }} />
          }
          <div>
            <p className="text-sm font-semibold" style={{ color: statusColor }}>
              Quality Gate — {statusLabel}
            </p>
            <p className="text-xs text-gray-500 mt-0.5">
              Score: {result.score}/100
              {result.autoFixedCount > 0 && ` · ${result.autoFixedCount} issue${result.autoFixedCount > 1 ? 's' : ''} auto-fixed`}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {hasIssues && runFix && (
            <button
              onClick={(e) => { e.stopPropagation(); runFix() }}
              disabled={fixing}
              className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-[#0F0F0F] text-white rounded-lg hover:bg-[#333] disabled:opacity-50 transition-colors"
            >
              <IconWrench className="w-3 h-3" />
              {fixing ? 'Fixing all…' : 'Fix All Issues'}
            </button>
          )}
          {expanded
            ? <IconChevronUp className="w-4 h-4 text-gray-400" />
            : <IconChevronDown className="w-4 h-4 text-gray-400" />
          }
        </div>
      </button>

      {expanded && (
        <div className="p-4 space-y-2 bg-white">
          {fixAllReport && (
            <div className="mb-3 p-3 rounded-lg border border-[#E8E8E4] bg-[#FAFAF8] space-y-2">
              <p className="text-xs font-semibold text-[#0F0F0F]">{fixAllReport.summary}</p>
              {fixAllReport.scoreBefore != null && fixAllReport.scoreAfter != null && (
                <p className="text-xs text-[#6B6B6B]">
                  Score: {fixAllReport.scoreBefore} → {fixAllReport.scoreAfter}
                </p>
              )}
              {fixAllReport.fixed.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-green-800 mb-1">Fixed automatically</p>
                  {fixAllReport.fixed.map(f => (
                    <p key={f.id} className="text-[11px] text-green-700">✓ {f.title} — {f.how}</p>
                  ))}
                </div>
              )}
              {fixAllReport.stillNeedsManualReview.length > 0 && (
                <div>
                  <p className="text-[11px] font-semibold text-amber-800 mb-1">Still needs manual review</p>
                  {fixAllReport.stillNeedsManualReview.map(f => (
                    <p key={f.id} className="text-[11px] text-amber-700">• {f.title} — {f.reason}</p>
                  ))}
                </div>
              )}
            </div>
          )}

          {result.issues.length === 0 ? (
            <p className="text-sm text-green-600 text-center py-2">
              ✓ All quality checks passed
            </p>
          ) : (
            result.issues
              .sort((a, b) => {
                const order = { critical: 0, warning: 1, info: 2 }
                return order[a.severity] - order[b.severity]
              })
              .map(issue => (
                <div
                  key={issue.id}
                  className={`flex gap-3 p-3 rounded-lg border ${severityBg(issue.severity)}`}
                >
                  <div className="mt-0.5">{severityIcon(issue.severity)}</div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-gray-900">{issue.title}</p>
                    <p className="text-xs text-gray-600 mt-0.5 leading-relaxed">{issue.description}</p>
                    {issue.location && (
                      <p className="text-xs text-gray-400 font-mono mt-1 truncate">
                        Near: &quot;{issue.location}&quot;
                      </p>
                    )}
                    {issue.autoFixable && issue.autoFixDescription && (
                      <p className="text-xs text-blue-600 mt-1">✦ {issue.autoFixDescription}</p>
                    )}
                    {!issue.autoFixable && (
                      <p className="text-xs text-gray-500 mt-1">Manual review required</p>
                    )}
                  </div>
                  <div className="flex-shrink-0">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${
                      issue.severity === 'critical'
                        ? 'bg-red-100 text-red-700'
                        : issue.severity === 'warning'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-blue-100 text-blue-700'
                    }`}>
                      {issue.category}
                    </span>
                  </div>
                </div>
              ))
          )}

          {result.blockers.length > 0 && (
            <div className="mt-3 p-3 bg-red-50 rounded-lg border border-red-200">
              <p className="text-xs font-semibold text-red-800 mb-1">Must fix before publishing:</p>
              {result.blockers.map((blocker, i) => (
                <p key={i} className="text-xs text-red-700">• {blocker}</p>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  )
}
