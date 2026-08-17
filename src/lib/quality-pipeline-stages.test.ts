/**
 * Unit tests for Quality Pipeline stage protocol + critical-stop helpers.
 * These do not call Anthropic — they verify the stream markers and abort rules
 * the Write UI and article-v2 route rely on.
 */
import { describe, expect, it } from 'vitest'
import {
  QUALITY_PIPELINE_STAGES,
  applyPipelineStageEvent,
  criticalStopReason,
  formatPipelineStageMarker,
  formatPipelineStoppedMarker,
  initialPipelineStageState,
  isCriticalPipelineStopIssue,
  markRemainingStagesSkipped,
  parsePipelineStageMarkers,
  parsePipelineStoppedMarker,
  stageLabel,
} from '@/lib/quality-pipeline-stages'
import { checkTopicAlignment } from '@/lib/topic-alignment'
import { hasInsertionCorruption } from '@/lib/sentence-integrity'
import { detectWrongBrandInBody, scoreFloorIssues } from '@/lib/article-quality-gate'

describe('quality pipeline stage markers', () => {
  it('lists the nine product stages in order', () => {
    expect(QUALITY_PIPELINE_STAGES.map(s => s.id)).toEqual([
      'research-outline',
      'writing-draft',
      'schema-check',
      'fact-checking',
      'citation-links',
      'humanize',
      'text-integrity',
      'brand-topic',
      'quality-gate',
    ])
  })

  it('round-trips stage markers from a streamed buffer', () => {
    const chunk =
      formatPipelineStageMarker({
        id: 'research-outline',
        status: 'running',
        label: stageLabel('research-outline'),
      }) +
      formatPipelineStageMarker({
        id: 'research-outline',
        status: 'pass',
        label: stageLabel('research-outline'),
        detail: 'Outline locked',
      }) +
      formatPipelineStageMarker({
        id: 'writing-draft',
        status: 'running',
        label: stageLabel('writing-draft'),
      })

    const events = parsePipelineStageMarkers(chunk)
    expect(events).toHaveLength(3)
    expect(events[0]).toMatchObject({ id: 'research-outline', status: 'running' })
    expect(events[1]).toMatchObject({ id: 'research-outline', status: 'pass', detail: 'Outline locked' })
    expect(events[2]).toMatchObject({ id: 'writing-draft', status: 'running' })
  })

  it('applies events onto UI state and skips remaining after abort', () => {
    let stages = initialPipelineStageState()
    stages = applyPipelineStageEvent(stages, {
      id: 'research-outline',
      status: 'pass',
      label: 'Research & outline',
    })
    stages = applyPipelineStageEvent(stages, {
      id: 'writing-draft',
      status: 'pass',
      label: 'Writing draft',
    })
    stages = applyPipelineStageEvent(stages, {
      id: 'brand-topic',
      status: 'fail',
      label: 'Brand/topic alignment',
      detail: 'Topic mismatch',
    })
    stages = markRemainingStagesSkipped(stages)

    expect(stages.find(s => s.id === 'research-outline')?.status).toBe('pass')
    expect(stages.find(s => s.id === 'brand-topic')?.status).toBe('fail')
    expect(stages.find(s => s.id === 'schema-check')?.status).toBe('skipped')
    expect(stages.find(s => s.id === 'quality-gate')?.status).toBe('skipped')
  })

  it('client checklist mirrors a mid-pipeline topic abort stream', () => {
    // Simulates what article-v2 emits when brand/topic fails after writing.
    const stream =
      formatPipelineStageMarker({ id: 'research-outline', status: 'running', label: stageLabel('research-outline') }) +
      formatPipelineStageMarker({ id: 'research-outline', status: 'pass', label: stageLabel('research-outline'), detail: 'Outline locked' }) +
      formatPipelineStageMarker({ id: 'writing-draft', status: 'running', label: stageLabel('writing-draft') }) +
      formatPipelineStageMarker({ id: 'writing-draft', status: 'pass', label: stageLabel('writing-draft') }) +
      formatPipelineStageMarker({ id: 'brand-topic', status: 'running', label: stageLabel('brand-topic') }) +
      formatPipelineStageMarker({
        id: 'brand-topic',
        status: 'fail',
        label: stageLabel('brand-topic'),
        detail: 'H1/body do not cover the requested keyword',
      }) +
      formatPipelineStoppedMarker({
        stageId: 'brand-topic',
        reason: 'H1/body do not cover the requested keyword',
        critical: true,
      })

    let stages = initialPipelineStageState()
    for (const ev of parsePipelineStageMarkers(stream)) {
      stages = applyPipelineStageEvent(stages, ev)
    }
    stages = markRemainingStagesSkipped(stages)
    const stopped = parsePipelineStoppedMarker(stream)

    expect(stopped?.stageId).toBe('brand-topic')
    expect(stages.find(s => s.id === 'research-outline')?.status).toBe('pass')
    expect(stages.find(s => s.id === 'writing-draft')?.status).toBe('pass')
    expect(stages.find(s => s.id === 'brand-topic')?.status).toBe('fail')
    // Later checklist stages must not look like they ran
    expect(stages.find(s => s.id === 'humanize')?.status).toBe('skipped')
    expect(stages.find(s => s.id === 'quality-gate')?.status).toBe('skipped')
  })
})

describe('critical pipeline stop rules', () => {
  it('treats brand, topic, integrity, and score floors as abort-worthy', () => {
    expect(isCriticalPipelineStopIssue({ id: 'brand-mismatch', severity: 'critical', category: 'brand-mismatch' })).toBe(true)
    expect(isCriticalPipelineStopIssue({ id: 'topic-alignment', severity: 'critical', category: 'topic-alignment' })).toBe(true)
    expect(isCriticalPipelineStopIssue({ id: 'score-floor-eeat', severity: 'critical', category: 'score-floor' })).toBe(true)
    expect(isCriticalPipelineStopIssue({ id: 'text-integrity-residual', severity: 'critical', category: 'text-integrity' })).toBe(true)
    expect(isCriticalPipelineStopIssue({ id: 'hedging-typically', severity: 'warning', category: 'hedging' })).toBe(false)
    expect(isCriticalPipelineStopIssue({ id: 'dated-claim-0', severity: 'warning', category: 'dated-policy' })).toBe(false)
  })

  it('stops on deliberate topic mismatch (mismatched keyword/topic fixture)', () => {
    const offTopicHtml = `
      <h1>How to Start a Crypto LLC in Delaware</h1>
      <p>Blockchain incorporation tips for digital asset founders. Tokenomics and wallet security matter.</p>
      <h2>Choosing a registered agent</h2>
      <p>Pick an agent familiar with web3 entities and NFT royalties.</p>
    `
    const alignment = checkTopicAlignment(offTopicHtml, 'EV charger installation cost UK')
    expect(alignment.aligned).toBe(false)
    expect(alignment.reason).toBeTruthy()

    const issue = {
      id: 'topic-alignment',
      severity: 'critical' as const,
      category: 'topic-alignment',
      title: alignment.reason || 'Topic mismatch',
    }
    expect(isCriticalPipelineStopIssue(issue)).toBe(true)
  })

  it('stops on residual insertion corruption', () => {
    const corrupted = '<p>The grant is £350 (verify at GOV.UK).350. Apply online.</p>'
    expect(hasInsertionCorruption(corrupted)).toBe(true)
    expect(
      isCriticalPipelineStopIssue({
        id: 'text-integrity-residual',
        severity: 'critical',
        category: 'text-integrity',
      }),
    ).toBe(true)
  })

  it('stops on wrong brand in body', () => {
    const html = '<p>At Auto Trader, we help you compare EV chargers across the UK market.</p>'
    const issue = detectWrongBrandInBody(html, 'MyCharge Co')
    expect(issue?.id).toBe('brand-mismatch')
    expect(isCriticalPipelineStopIssue(issue!)).toBe(true)
  })

  it('stops on E-E-A-T / density score floors', () => {
    const floors = scoreFloorIssues({
      eeatScore: 30,
      keywordDensityPct: 0.05,
      keywordDensityScore: 5,
      keyword: 'home EV charger',
    })
    expect(floors.length).toBeGreaterThanOrEqual(2)
    expect(floors.every(i => isCriticalPipelineStopIssue(i))).toBe(true)
  })
})
