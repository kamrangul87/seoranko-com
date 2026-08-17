/**
 * Visible Quality Pipeline stages for article-v2 generation.
 *
 * Stream protocol — one HTML comment per status change:
 *   <!--SEORANKO_PIPELINE_STAGE:{"id":"...","status":"running|pass|fail|fixed|skipped","label":"...","detail":"..."}-->
 *
 * Critical abort (stops further generation):
 *   <!--SEORANKO_PIPELINE_STOPPED:{"stageId":"...","reason":"...","critical":true}-->
 * followed by the existing SEORANKO_ERROR marker so older clients still surface the failure.
 */

export type PipelineStageId =
  | 'research-outline'
  | 'writing-draft'
  | 'schema-check'
  | 'fact-checking'
  | 'citation-links'
  | 'humanize'
  | 'text-integrity'
  | 'brand-topic'
  | 'quality-gate'

export type PipelineStageStatus = 'pending' | 'running' | 'pass' | 'fail' | 'fixed' | 'partial' | 'skipped'

export interface PipelineStageDef {
  id: PipelineStageId
  label: string
}

/** UI / documentation order — matches the product checklist. */
export const QUALITY_PIPELINE_STAGES: readonly PipelineStageDef[] = [
  { id: 'research-outline', label: 'Research & outline' },
  { id: 'writing-draft', label: 'Writing draft' },
  { id: 'schema-check', label: 'Schema check' },
  { id: 'fact-checking', label: 'Fact-checking' },
  { id: 'citation-links', label: 'Citation link validation' },
  { id: 'humanize', label: 'Humanize pass' },
  { id: 'text-integrity', label: 'Text-integrity check' },
  { id: 'brand-topic', label: 'Brand/topic alignment' },
  { id: 'quality-gate', label: 'Final Quality Gate' },
] as const

export interface PipelineStageEvent {
  id: PipelineStageId
  status: Exclude<PipelineStageStatus, 'pending'>
  label: string
  detail?: string
}

export interface PipelineStoppedEvent {
  stageId: PipelineStageId
  reason: string
  critical: true
}

const STAGE_LABEL = Object.fromEntries(
  QUALITY_PIPELINE_STAGES.map(s => [s.id, s.label]),
) as Record<PipelineStageId, string>

export function stageLabel(id: PipelineStageId): string {
  return STAGE_LABEL[id] ?? id
}

export function formatPipelineStageMarker(event: PipelineStageEvent): string {
  const payload: PipelineStageEvent = {
    id: event.id,
    status: event.status,
    label: event.label || stageLabel(event.id),
    ...(event.detail ? { detail: event.detail } : {}),
  }
  return `\n<!--SEORANKO_PIPELINE_STAGE:${JSON.stringify(payload)}-->`
}

export function formatPipelineStoppedMarker(event: PipelineStoppedEvent): string {
  return `\n<!--SEORANKO_PIPELINE_STOPPED:${JSON.stringify(event)}-->`
}

export function parsePipelineStageMarkers(chunk: string): PipelineStageEvent[] {
  const out: PipelineStageEvent[] = []
  const re = /<!--SEORANKO_PIPELINE_STAGE:(\{[\s\S]*?\})-->/g
  let m: RegExpExecArray | null
  while ((m = re.exec(chunk)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as PipelineStageEvent
      if (parsed?.id && parsed?.status) out.push(parsed)
    } catch {
      /* ignore malformed */
    }
  }
  return out
}

export function parsePipelineStoppedMarker(chunk: string): PipelineStoppedEvent | null {
  const m = chunk.match(/<!--SEORANKO_PIPELINE_STOPPED:(\{[\s\S]*?\})-->/)
  if (!m) return null
  try {
    const parsed = JSON.parse(m[1]) as PipelineStoppedEvent
    if (parsed?.stageId && parsed?.reason) return { ...parsed, critical: true }
  } catch {
    /* ignore */
  }
  return null
}

/** Issues that must abort generation rather than continue to a wall of end-of-run findings. */
export function isCriticalPipelineStopIssue(issue: {
  id?: string
  category?: string
  severity?: string
}): boolean {
  if (issue.severity !== 'critical') return false
  if (issue.id === 'brand-mismatch' || issue.id === 'missing-brand') return true
  if (issue.id === 'topic-alignment' || issue.category === 'topic-alignment') return true
  if (issue.category === 'score-floor') return true
  if (issue.category === 'merge-artifact') return true
  if (issue.id?.startsWith('text-integrity') || issue.category === 'text-integrity') return true
  return false
}

export function criticalStopReason(
  stageId: PipelineStageId,
  detail: string,
): string {
  const label = stageLabel(stageId)
  return `${label} failed: ${detail}`
}

export function initialPipelineStageState(): Array<PipelineStageDef & { status: PipelineStageStatus; detail?: string }> {
  return QUALITY_PIPELINE_STAGES.map(s => ({ ...s, status: 'pending' as const }))
}

export function applyPipelineStageEvent<T extends { id: PipelineStageId; status: PipelineStageStatus; detail?: string }>(
  stages: T[],
  event: PipelineStageEvent,
): T[] {
  return stages.map(s => {
    if (s.id !== event.id) return s
    return {
      ...s,
      status: event.status,
      detail: event.detail ?? s.detail,
    }
  })
}

/** After a critical stop, mark every still-pending stage as skipped. */
export function markRemainingStagesSkipped<T extends { status: PipelineStageStatus }>(stages: T[]): T[] {
  return stages.map(s =>
    s.status === 'pending' || s.status === 'running'
      ? { ...s, status: 'skipped' as const }
      : s,
  )
}
