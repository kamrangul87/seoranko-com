'use client'

export interface WinnabilityResult {
  keyword: string
  verdict: string
  score: number
  confidence: number
  reasoning: string
  serpComposition: {
    informationalCount: number
    productPageCount: number
    videoCount: number
    bigBrandCount: number
  }
  intentMatch: boolean
  recommendedAction: string
  alternativeKeyword?: string
}

// Inline SVG icons (lucide-react not installed)
function IconTarget({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>
    </svg>
  )
}
function IconTrendingUp({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  )
}
function IconAlertTriangle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
      <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
    </svg>
  )
}
function IconXCircle({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10"/>
      <line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>
    </svg>
  )
}
function IconArrowRight({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="5" y1="12" x2="19" y2="12"/>
      <polyline points="12 5 19 12 12 19"/>
    </svg>
  )
}

export function WinnabilityCard({ result }: { result: WinnabilityResult }) {
  const verdictConfig: Record<string, { color: string; bg: string; border: string; Icon: React.ComponentType<{ className?: string }>; label: string }> = {
    'highly-winnable': { color: '#1D9E75', bg: '#E1F5EE', border: '#7BCFAE', Icon: IconTrendingUp, label: 'Highly winnable' },
    'winnable':        { color: '#2563EB', bg: '#E6F1FB', border: '#93C5FD', Icon: IconTarget,    label: 'Winnable' },
    'contested':       { color: '#BA7517', bg: '#FAEEDA', border: '#E8C97A', Icon: IconAlertTriangle, label: 'Contested' },
    'unwinnable':      { color: '#E24B4A', bg: '#FCEBEB', border: '#E8BABA', Icon: IconXCircle,   label: 'Unwinnable — skip this' },
    'redirect':        { color: '#7C3AED', bg: '#EEEDFE', border: '#AFA9EC', Icon: IconArrowRight, label: 'Try a different keyword' },
  }

  const config = verdictConfig[result.verdict] || verdictConfig['winnable']
  const Icon = config.Icon

  return (
    <div
      className="rounded-xl border p-4 mb-4"
      style={{ background: config.bg, borderColor: config.border }}
    >
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span style={{ color: config.color }}><Icon className="w-4 h-4" /></span>
          <span className="text-sm font-semibold" style={{ color: config.color }}>
            RANKO says: {config.label}
          </span>
        </div>
        <div className="flex items-center gap-4">
          <div className="text-right">
            <div className="text-xl font-bold" style={{ color: config.color }}>{result.score}</div>
            <div className="text-xs text-gray-400">winnability</div>
          </div>
          <div className="text-right">
            <div className="text-xl font-bold text-gray-500">{result.confidence}%</div>
            <div className="text-xs text-gray-400">confident</div>
          </div>
        </div>
      </div>

      {/* Reasoning */}
      <p className="text-sm text-gray-700 mb-3 leading-relaxed">{result.reasoning}</p>

      {/* SERP composition */}
      <div className="grid grid-cols-4 gap-2 mb-3">
        {[
          { label: 'Informational', count: result.serpComposition.informationalCount, good: true },
          { label: 'Product pages', count: result.serpComposition.productPageCount, good: false },
          { label: 'Videos', count: result.serpComposition.videoCount, good: false },
          { label: 'Big brands', count: result.serpComposition.bigBrandCount, good: false },
        ].map(item => (
          <div key={item.label} className="bg-white bg-opacity-60 rounded-lg p-2 text-center">
            <div className={`text-lg font-bold ${item.good ? 'text-green-600' : item.count > 5 ? 'text-red-500' : 'text-gray-500'}`}>
              {item.count}
            </div>
            <div className="text-xs text-gray-400 leading-tight">{item.label}</div>
          </div>
        ))}
      </div>

      {/* Action */}
      <div className="flex items-start gap-2 p-2.5 bg-white bg-opacity-70 rounded-lg">
        <span className="text-xs font-medium text-gray-600 flex-shrink-0 mt-0.5">RANKO recommends:</span>
        <span className="text-xs text-gray-700">{result.recommendedAction}</span>
      </div>

      {/* Alternative keyword if redirect */}
      {result.alternativeKeyword && (
        <div className="mt-2 flex items-center gap-2 text-xs text-purple-700">
          <IconArrowRight className="w-3 h-3" />
          Try instead: <strong>&ldquo;{result.alternativeKeyword}&rdquo;</strong>
        </div>
      )}
    </div>
  )
}
