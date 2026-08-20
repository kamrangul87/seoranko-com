/**
 * Permanent quality regression suite (Phases 14–15, A–X).
 *
 * Uses real-failure fixtures from src/lib/fixtures/articles.ts.
 * Proves recurring failure classes are gone — not only synthetic unit cases.
 */

import { describe, it, expect } from 'vitest'
import {
  ARTICLE_FIXTURES,
  FIXTURE_CONTENT,
  FIXTURE_HERO,
  FIXTURE_LOGO,
  GOV_GRANT_URL,
} from '@/lib/fixtures/articles'
import { buildFinalArticleArtifact } from '@/lib/final-article-artifact'
import { applyGeneratedSchemaToHtml, countSchemaType } from '@/lib/schema-dedupe'
import { generateArticleSchema } from '@/lib/schema-generator'
import { validateSchema } from '@/lib/schema-validator'
import {
  collectSchemaQualityIssues,
  recomputeQualityGateTotals,
  runQualityGate,
  buildDatedPolicyIssues,
} from '@/lib/article-quality-gate'
import {
  resolveLogoPolicy,
  expectOrganizationLogoFromPolicy,
} from '@/lib/quality-gate-policy'
import {
  buildQualityGateRunOptions,
  QUALITY_GATE_CALLERS,
} from '@/lib/quality-gate-run-options'
import { evaluateFreshness, evaluateFreshnessSync } from '@/lib/freshness-evaluator'
import {
  researchClaimFreshness,
  stripArticleDatelineEvidence,
  shouldResearchClaim,
} from '@/lib/freshness-research'
import { evaluateHedging } from '@/lib/hedging-policy'
import { assessEditorialWordCount } from '@/lib/editorial-word-count'
import { countArticleWords } from '@/lib/word-count'
import { maskDomainLikeTokens, countSentences } from '@/lib/sentence-boundaries'
import { validateArticleStructure } from '@/lib/structure-validator'
import { confirmAutoFixOutcomes, scoreFromIssues } from '@/lib/autofix-confirmation'
import { fixAllArticleIssues } from '@/lib/article-fix-all'
import { severityForFreshnessFinding } from '@/lib/freshness-policy'
import { scoreHtmlLocally } from '@/lib/content-scorer'
import type { ArticleImageSet, GeneratedImage } from '@/lib/image-generator'

const NOW = new Date('2026-08-18T12:00:00.000Z')

function img(p: Partial<GeneratedImage> & { id: string; url: string }): GeneratedImage {
  return {
    width: 800,
    height: 533,
    alt: 'alt',
    caption: 'caption',
    placement: 'content',
    prompt: 'prompt',
    ...p,
  }
}

const schemaBase = {
  title: 'Home EV charger installation guide',
  description: 'How to install a home EV charger safely.',
  keyword: 'home EV charger installation',
  authorName: 'Kamran Gul',
  publishDate: '2026-08-18T00:00:00.000Z',
  dateModified: '2026-08-18T00:00:00.000Z',
  articleUrl: 'https://example.com/blog/home-ev-charger-installation',
  organizationName: 'Example Brand',
  organizationUrl: 'https://example.com',
  organizationLogoUrl: FIXTURE_LOGO,
  market: 'United Kingdom',
}

describe('Quality regression suite A–X (fixtures)', () => {
  // ── A. Final Article.image parity ──────────────────────────────────────
  it('A: Final Article.image matches shipped hero URL; QG does not report missing image', async () => {
    const set: ArticleImageSet = {
      hero: img({ id: 'hero', url: FIXTURE_HERO, width: 1200, height: 630, placement: 'Hero' }),
      content: [img({ id: 'c0', url: FIXTURE_CONTENT })],
      niche: 'automotive',
      styleDescriptor: 'editorial',
      imageStats: { requested: 2, generated: 2, failures: [] },
    }
    const artifact = buildFinalArticleArtifact({
      proseHtml: ARTICLE_FIXTURES.belowWordTargetComplete,
      imageSet: set,
      schemaInput: schemaBase,
    })
    expect(artifact.primaryImageUrl).toBe(FIXTURE_HERO)
    expect(artifact.schemaResult.imageUrl).toBe(FIXTURE_HERO)
    expect(artifact.html).toContain(FIXTURE_HERO)

    const qr = await runQualityGate(artifact.html, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 500,
      expectOrganizationLogo: true,
    })
    expect(
      qr.issues.filter((i) => i.category === 'schema' && /Article:\s*image/i.test(i.title)),
    ).toHaveLength(0)
  })

  // ── B. Organization.logo policy parity ─────────────────────────────────
  it('B: logo require/omit policy identical for all callers via buildQualityGateRunOptions', () => {
    const requireSettings = { configured: true, logoUrl: FIXTURE_LOGO }
    const omitSettings = { configured: true, logoUrl: null as string | null }

    for (const caller of QUALITY_GATE_CALLERS) {
      const req = buildQualityGateRunOptions({
        brand: 'Example Brand',
        keyword: 'ev charger',
        brandSettings: requireSettings,
        caller,
      })
      const omit = buildQualityGateRunOptions({
        brand: 'Example Brand',
        keyword: 'ev charger',
        brandSettings: omitSettings,
        caller,
      })
      expect(req.expectOrganizationLogo).toBe(true)
      expect(omit.expectOrganizationLogo).toBe(false)
      expect(req.expectOrganizationLogo).toBe(
        expectOrganizationLogoFromPolicy(resolveLogoPolicy({ brandSettings: requireSettings })),
      )
    }
  })

  // ── C. Duplicate JSON-LD ───────────────────────────────────────────────
  it('C: duplicate JSON-LD is collapsed to one Article + one Organization on sync', () => {
    const generated = generateArticleSchema({
      ...schemaBase,
      imageUrl: FIXTURE_HERO,
      wordCount: 100,
    })
    const once = applyGeneratedSchemaToHtml(ARTICLE_FIXTURES.duplicateJsonLd, generated.combinedScriptTag)
    expect(countSchemaType(once, 'Article')).toBe(1)
    expect(countSchemaType(once, 'Organization')).toBe(1)
    expect(once).toContain(FIXTURE_HERO)
    expect(once).not.toContain('Stale title')
  })

  // ── D. Hero failure + content image success ────────────────────────────
  it('D: empty hero URL falls back to first content image for Article.image', () => {
    const set: ArticleImageSet = {
      hero: img({ id: 'hero', url: '', width: 1200, height: 630, placement: 'Hero' }),
      content: [img({ id: 'c0', url: FIXTURE_CONTENT })],
      niche: 'automotive',
      styleDescriptor: 'editorial',
      imageStats: { requested: 2, generated: 1, failures: ['hero'] },
    }
    const artifact = buildFinalArticleArtifact({
      proseHtml: ARTICLE_FIXTURES.belowWordTargetComplete,
      imageSet: set,
      schemaInput: schemaBase,
    })
    expect(artifact.primaryImageUrl).toBe(FIXTURE_CONTENT)
    expect(artifact.schemaResult.imageUrl).toBe(FIXTURE_CONTENT)
  })

  // ── E. Missing image ───────────────────────────────────────────────────
  it('E: missing Article.image still surfaces when required', () => {
    const result = validateSchema(ARTICLE_FIXTURES.missingImage, { expectOrganizationLogo: true })
    expect(result.issues.some((i) => i.property === 'image' || /image/i.test(i.message))).toBe(true)
  })

  // ── F. Missing logo ────────────────────────────────────────────────────
  it('F: missing logo surfaces when policy requires it; silent when omit', () => {
    const required = validateSchema(ARTICLE_FIXTURES.missingLogo, { expectOrganizationLogo: true })
    expect(required.issues.some((i) => /logo/i.test(i.property + i.message))).toBe(true)

    const omitted = validateSchema(ARTICLE_FIXTURES.missingLogo, { expectOrganizationLogo: false })
    expect(omitted.issues.filter((i) => /logo/i.test(i.property + i.message))).toHaveLength(0)
  })

  // ── G. Recheck ─────────────────────────────────────────────────────────
  it('G: recheck path uses shared logo policy on fixture with image+logo present', async () => {
    const opts = buildQualityGateRunOptions({
      brand: 'Example Brand',
      keyword: 'home EV charger installation',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 40,
      maxWordCount: 400,
      brandSettings: { configured: true, logoUrl: FIXTURE_LOGO },
      caller: 'recheck',
    })
    const qr = await runQualityGate(ARTICLE_FIXTURES.schemaImageLogoPresent, {
      brand: opts.brand,
      keyword: opts.keyword,
      authorName: opts.authorName || 'Kamran Gul',
      registeredLinkDomains: opts.registeredLinkDomains,
      minWordCount: opts.minWordCount,
      maxWordCount: opts.maxWordCount,
      expectOrganizationLogo: opts.expectOrganizationLogo,
    })
    expect(
      collectSchemaQualityIssues(ARTICLE_FIXTURES.schemaImageLogoPresent, true).filter(
        (i) => /missing/i.test(i.description) && /image|logo/i.test(i.title + i.description),
      ),
    ).toHaveLength(0)
    expect(qr.explainable.score).toBe(qr.score)
  })

  // ── H. Fix All ─────────────────────────────────────────────────────────
  it('H: Fix All revalidates and returns score from final HTML', async () => {
    const result = await fixAllArticleIssues({
      html: ARTICLE_FIXTURES.repeatedTypically,
      keyword: 'home wallbox',
      brand: 'Example Brand',
      registeredLinkDomains: ['example.com'],
      targetWordCount: 200,
      expectOrganizationLogo: false,
    })
    expect(result.qualityGateAfter.score).toBe(
      scoreFromIssues(result.qualityGateAfter.issues),
    )
    expect(result.qualityGateAfter.articleAfterAutoFix.length).toBeGreaterThan(0)
  })

  // ── I. Improve ─────────────────────────────────────────────────────────
  it('I: Improve caller options derive expectOrganizationLogo from shared policy', () => {
    const improve = buildQualityGateRunOptions({
      brand: 'Example Brand',
      keyword: 'ev',
      brandSettings: { configured: true, logoUrl: FIXTURE_LOGO },
      caller: 'improve',
    })
    const generate = buildQualityGateRunOptions({
      brand: 'Example Brand',
      keyword: 'ev',
      brandSettings: { configured: true, logoUrl: FIXTURE_LOGO },
      caller: 'generate',
    })
    expect(improve.expectOrganizationLogo).toBe(generate.expectOrganizationLogo)
    expect(improve.expectOrganizationLogo).toBe(true)
  })

  // ── J. Domain names not sentence boundaries ────────────────────────────
  it('J: gov.uk / energynetworks.org are not merge-artifact / sentence-boundary false positives', async () => {
    const masked = maskDomainLikeTokens(
      ARTICLE_FIXTURES.domainGovUk.replace(/<[^>]+>/g, ' '),
    )
    expect(masked).not.toMatch(/\.\s*[a-z]{1,4}\.\s+[A-Z]/)
    const qr = await runQualityGate(ARTICLE_FIXTURES.domainGovUk, {
      brand: 'Example Brand',
      keyword: 'network operator notification',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 20,
      maxWordCount: 200,
      expectOrganizationLogo: false,
    })
    expect(qr.issues.filter((i) => i.category === 'merge-artifact')).toHaveLength(0)
  })

  // ── K. Real dense paragraphs still detected ────────────────────────────
  it('K: dense multi-sentence paragraphs are still flagged for scannability', () => {
    const paragraphs =
      ARTICLE_FIXTURES.denseParagraph.match(/<p[^>]*>([\s\S]*?)<\/p>/gi) || []
    const dense = paragraphs.filter((p) => {
      const plain = p.replace(/<[^>]+>/g, '')
      return countSentences(plain) >= 6
    })
    expect(dense.length).toBeGreaterThanOrEqual(4)
    const structure = validateArticleStructure(ARTICLE_FIXTURES.denseParagraph)
    expect(structure.some((s) => s.category === 'scannability')).toBe(true)
  })

  // ── L. Dated claim with official source ────────────────────────────────
  it('L: dated claim with official GOV.UK source is bound (not unsupported)', () => {
    const findings = evaluateFreshnessSync(ARTICLE_FIXTURES.datedWithSource, { now: NOW })
    const grant = findings.find((f) => /£500|grant/i.test(f.sentence))
    expect(grant).toBeTruthy()
    expect(grant!.citationUrl).toContain('gov.uk')
    expect(grant!.evidenceStatus).not.toBe('UNSUPPORTED')
  })

  // ── M. Dated claim without source ──────────────────────────────────────
  it('M: current £350 without source needs review / unsupported', () => {
    const issues = buildDatedPolicyIssues(ARTICLE_FIXTURES.datedNoSource, { now: NOW })
    expect(issues.some((i) => /£350|time-sensitive|source/i.test(i.title + i.description))).toBe(
      true,
    )
  })

  // ── N. Historical grant claim ──────────────────────────────────────────
  it('N: historical grant claim is HISTORICAL, not critical outdated-current', () => {
    const findings = evaluateFreshnessSync(ARTICLE_FIXTURES.grant350, { now: NOW })
    const hist = findings.filter((f) => /Applications before|historical/i.test(f.sentence))
    expect(hist.length).toBeGreaterThan(0)
    for (const f of hist) {
      expect(f.timeStatus).toBe('HISTORICAL')
      expect(severityForFreshnessFinding(f)).not.toBe('critical')
    }
  })

  // ── O. Outdated current grant claim (research) ─────────────────────────
  it('O: currently £350 vs research £500 → OUTDATED with source URL/date/verifiedAt', async () => {
    const sentence = 'The grant is currently £350 for eligible workplaces.'
    const result = await researchClaimFreshness({
      sentence,
      figureText: '£350',
      now: NOW,
      provider: async () => ({
        sourceUrl: GOV_GRANT_URL,
        sourceUpdatedAt: '2026-04-01',
        currentValueText: '£500',
        amounts: ['£500'],
        supportsCurrent: true,
        supportsHistorical: false,
      }),
    })
    expect(result.claim.status).toBe('OUTDATED')
    expect(result.claim.sourceUrl).toBe(GOV_GRANT_URL)
    expect(result.claim.sourceDate).toBe('2026-04-01')
    expect(result.claim.verifiedAt).toMatch(/^2026-08-18/)
    expect(result.claim.detail).toMatch(/£500/)

    const findings = await evaluateFreshness(ARTICLE_FIXTURES.datedNoSource, {
      now: NOW,
      evidenceProvider: async () => ({
        sourceUrl: GOV_GRANT_URL,
        sourceUpdatedAt: '2026-04-01',
        currentValueText: '£500',
        amounts: ['£500'],
        supportsCurrent: true,
      }),
    })
    const outdated = findings.find(
      (f) => f.timeStatus === 'OUTDATED' || f.evidenceStatus === 'CONTRADICTED',
    )
    expect(outdated).toBeTruthy()
    expect(outdated!.citationUrl).toContain('gov.uk')
    expect(outdated!.evidenceSummary).toMatch(/£500/)
  })

  // ── P. "now" used as non-factual language ──────────────────────────────
  it('P: instructional "check the rules now" is not researched as a factual claim', () => {
    expect(shouldResearchClaim('Check the rules now before you submit an application.', NOW)).toBe(
      false,
    )
    const issues = buildDatedPolicyIssues(ARTICLE_FIXTURES.grant350, { now: NOW })
    expect(issues.every((i) => !/check the rules now/i.test(i.title + i.description))).toBe(true)
  })

  // ── Q. Repetitive hedge language ───────────────────────────────────────
  it('Q: repeated typically is REAL_REPETITION / over-hedging, not ignored', () => {
    const hedge = evaluateHedging(ARTICLE_FIXTURES.repeatedTypically)
    expect(
      hedge.occurrences.some(
        (f) => f.classification === 'REAL_REPETITION' || f.classification === 'OVER_HEDGING',
      ) || hedge.densityPer100 > 2,
    ).toBe(true)
  })

  // ── R. Appropriate uncertainty language ────────────────────────────────
  it('R: appropriate uncertainty is not treated as repetitive hedge failure', () => {
    const hedge = evaluateHedging(ARTICLE_FIXTURES.appropriateUncertainty)
    expect(
      hedge.occurrences.every(
        (f) =>
          f.classification === 'APPROPRIATE_QUALIFICATION' ||
          f.classification === 'UNSUPPORTED_CLAIM',
      ) || hedge.occurrences.length === 0 || hedge.densityPer100 < 3,
    ).toBe(true)
  })

  // ── S. Word count below target but complete ────────────────────────────
  it('S: below user target but complete → editorial advisory (info), not Google rule', () => {
    const words = countArticleWords(ARTICLE_FIXTURES.belowWordTargetComplete)
    const assess = assessEditorialWordCount(words, 2000, {
      coverageIncomplete: false,
      kind: 'USER_TARGET',
    })
    expect(assess.severity === 'info' || assess.severity === null).toBe(true)
    expect(assess.classification).not.toBe('CONTENT_COVERAGE')
  })

  // ── T. Short article missing topical coverage ──────────────────────────
  it('T: short off-topic article fails topic alignment / coverage', async () => {
    const qr = await runQualityGate(ARTICLE_FIXTURES.shortMissingCoverage, {
      brand: 'Example Brand',
      keyword: 'home EV charger installation grant',
      authorName: 'Kamran Gul',
      registeredLinkDomains: ['example.com'],
      minWordCount: 800,
      expectOrganizationLogo: false,
    })
    expect(
      qr.issues.some(
        (i) =>
          i.category === 'topic-alignment' ||
          i.category === 'word-count' ||
          i.severity === 'critical',
      ),
    ).toBe(true)
    expect(qr.explainable.publishDecision).not.toBe('READY')
  })

  // ── U. Auto-fix followed by final revalidation ────────────────────────
  it('U: autofix confirmation only counts resolved issues after revalidation', () => {
    const confirmation = confirmAutoFixOutcomes({
      beforeIssues: [
        { id: 'hedging-typically', category: 'hedging', severity: 'warning', title: 'Typically' },
      ],
      afterIssues: [
        { id: 'hedging-typically', category: 'hedging', severity: 'warning', title: 'Typically' },
        { id: 'new-warn', category: 'ai-slop', severity: 'warning', title: 'New' },
      ],
      mutationAttempts: 3,
      scoreBefore: 95,
      scoreAfter: 90,
    })
    expect(confirmation.mayReportAsFixed).toBe(false)
    expect(confirmation.revalidationFoundAdditionalIssues).toBe(true)
    expect(confirmation.confirmedResolved).toHaveLength(0)
  })

  // ── V. Score remains based on final artifact ───────────────────────────
  it('V: score is deterministic from final issues only (info ignored)', () => {
    const gate = recomputeQualityGateTotals({
      issues: [
        {
          id: 'word-count-advisory',
          severity: 'info',
          category: 'word-count',
          title: 'Advisory',
          description: 'x',
          autoFixable: false,
        },
        {
          id: 'schema-x',
          severity: 'warning',
          category: 'schema',
          title: 'Schema warn',
          description: 'x',
          autoFixable: false,
        },
      ],
      autoFixedCount: 2,
      articleAfterAutoFix: ARTICLE_FIXTURES.schemaImageLogoPresent,
    })
    expect(gate.score).toBe(95)
    expect(gate.explainable.scoreExplanation).toMatch(/do not reduce the score/)
    expect(gate.articleAfterAutoFix).toContain(FIXTURE_HERO)
  })

  // ── W. All runQualityGate callers use common policy ────────────────────
  it('W: generate/recheck/improve/fix-all share expectOrganizationLogo derivation', () => {
    const settings = { configured: true, logoUrl: FIXTURE_LOGO as string | null }
    const flags = QUALITY_GATE_CALLERS.map(
      (caller) =>
        buildQualityGateRunOptions({
          brand: 'Example Brand',
          keyword: 'x',
          brandSettings: settings,
          caller,
        }).expectOrganizationLogo,
    )
    expect(new Set(flags).size).toBe(1)
    expect(flags[0]).toBe(true)
  })

  // ── X. Persisted score equals streamed final score ─────────────────────
  it('X: scoreHtmlLocally(finalHtml) is the streamed value — not an earlier draft', () => {
    const draft = '<h1>Draft</h1><p>Short draft about weather.</p>'
    const finalHtml = ARTICLE_FIXTURES.belowWordTargetComplete
    const draftScores = scoreHtmlLocally(draft, 'home EV charger installation')
    const finalScores = scoreHtmlLocally(finalHtml, 'home EV charger installation')
    // Final artifact must be what we persist/stream — draft and final differ
    expect(finalScores.searchScore).not.toBe(draftScores.searchScore)
    // Persisted quality gate score equals recompute from same final issues
    const issues: Array<{
      id: string
      severity: 'warning'
      category: 'hedging'
      title: string
      description: string
      autoFixable: boolean
    }> = [
      {
        id: 'a',
        severity: 'warning',
        category: 'hedging',
        title: 't',
        description: 'd',
        autoFixable: false,
      },
    ]
    const persisted = recomputeQualityGateTotals({
      issues,
      autoFixedCount: 0,
      articleAfterAutoFix: finalHtml,
    })
    expect(persisted.score).toBe(scoreFromIssues(issues))
    expect(persisted.score).toBe(persisted.explainable.score)
  })

  // ── Phase 13 / 15 extras ───────────────────────────────────────────────
  it('article Last updated dateline is stripped and never counts as claim evidence', () => {
    const stripped = stripArticleDatelineEvidence(ARTICLE_FIXTURES.grant350)
    expect(stripped).not.toMatch(/Last updated/i)
    // Unsourced current £350 still needs a source despite dateline
    const issues = buildDatedPolicyIssues(ARTICLE_FIXTURES.grant350, { now: NOW })
    expect(
      issues.some((i) => /currently £350|£350|time-sensitive|source/i.test(i.title + i.description)),
    ).toBe(true)
  })

  it('fixture with image+logo present: historical false-positive class is gone', () => {
    const schema = validateSchema(ARTICLE_FIXTURES.schemaImageLogoPresent, {
      expectOrganizationLogo: true,
    })
    expect(
      schema.issues.filter(
        (i) =>
          (i.property === 'image' || /logo/i.test(i.property)) && /missing/i.test(i.message),
      ),
    ).toHaveLength(0)
  })
})
