/**
 * Demo findings run — mirrors post-rollup autodun.com sample (11 pages).
 * Shape matches detector buckets; detectors themselves are not invoked here.
 */

import { classifySurfaceClass, classifyVerdictBucket } from './buckets'
import { sourcesForDossier } from './sources'
import { dossierSlugForTopic } from './topic-registry'
import type { UiFinding } from './types'

function buildFinding(
  partial: Omit<
    UiFinding,
    | 'bucket'
    | 'surfaceClass'
    | 'sources'
    | 'dossierSlug'
    | 'reportOnly'
  > & { reportOnly?: boolean },
): UiFinding {
  const dossierSlug = dossierSlugForTopic(partial.topicId)
  const reportOnly =
    partial.reportOnly ??
    (!partial.autoFixable &&
      (partial.verdict.startsWith('human-review-') ||
        partial.verdict.startsWith('d17-') ||
        partial.verdict.startsWith('observation-') ||
        partial.verdict.startsWith('report-') ||
        partial.verdict.startsWith('finding-orphan') ||
        partial.verdict.startsWith('moderate-out-of-scope') ||
        partial.verdict.startsWith('low-lang')))
  const bucket = classifyVerdictBucket(partial.verdict)
  // Informational force
  const forcedReportOnly =
    bucket === 'informational' ? true : reportOnly
  return {
    ...partial,
    reportOnly: forcedReportOnly,
    bucket,
    surfaceClass: classifySurfaceClass(partial.verdict, {
      autoFixable: partial.autoFixable,
      reportOnly: forcedReportOnly,
    }),
    dossierSlug,
    sources: sourcesForDossier(dossierSlug),
  }
}

/**
 * Actionable (10) + informational (17) + attached internal evidence.
 * Matches AUDIT_FOUR_FIXES_AUTODUN_ROLLUP + consolidation audit counts.
 */
export function buildDemoFindings(): UiFinding[] {
  const origin = 'https://autodun.com'

  const actionable: UiFinding[] = [
    buildFinding({
      id: 'fs-38-entity-url',
      topicId: '38',
      kind: 'structured-data/contradicts-visible-page',
      verdict: 'human-review-entity-url-mismatch',
      severity: 'high',
      detail:
        '10 pages inherit human-review-entity-url-mismatch from generator:autodun-blog-jsonld. Entity url ≠ page url carrying the markup (D6). Both are site claims — syndication may be deliberate.',
      pageUrl: `${origin}/blog`,
      declarationSite: 'generator:autodun-blog-jsonld',
      affectedUrlCount: 10,
      rolledUp: true,
      autoFixable: false,
      reportOnly: true,
      proposedDiff: null,
      evidenceValues: {
        left: 'https://autodun.com/',
        right: 'https://autodun.com/blog/electric-car-charger-map-uk.html',
        leftLabel: 'Entity url (example)',
        rightLabel: 'Page url (example)',
      },
      internalEvidence: [
        {
          verdict: 'suppress-dateModified-equals-datePublished',
          detail: 'dateModified equals datePublished — valid (related pages)',
        },
        {
          verdict: 'suppress-unknown-type',
          detail: 'Unknown schema types on related markup — not non-compliant',
        },
      ],
    }),
    buildFinding({
      id: 'fs-49-no-height-auto',
      topicId: '49',
      kind: 'performance/img-missing-dimensions',
      verdict: 'human-review-no-height-auto',
      severity: 'high',
      detail:
        '5 pages inherit human-review-no-height-auto from generator:autodun-blog-images. CSS height:auto with missing dimensions — human review.',
      pageUrl: `${origin}/blog`,
      declarationSite: 'generator:autodun-blog-images',
      affectedUrlCount: 5,
      rolledUp: true,
      autoFixable: false,
      reportOnly: true,
      proposedDiff: null,
      evidenceValues: null,
      internalEvidence: [],
    }),
    buildFinding({
      id: 'fs-49-wrong-ratio',
      topicId: '49',
      kind: 'performance/img-missing-dimensions',
      verdict: 'finding-wrong-ratio',
      severity: 'moderate',
      detail:
        '2 pages inherit finding-wrong-ratio from generator:autodun-blog-images. Declared width/height ratio disagrees with intrinsic.',
      pageUrl: `${origin}/blog/mot-cost-uk-2026.html`,
      declarationSite: 'generator:autodun-blog-images',
      affectedUrlCount: 2,
      rolledUp: true,
      autoFixable: false,
      reportOnly: true,
      proposedDiff: {
        summary: 'Align width/height attributes to intrinsic ratio',
        before: '<img src="hero.jpg" width="800" height="600">',
        after: '<img src="hero.jpg" width="800" height="450">',
        targetPath: 'generator:autodun-blog-images',
      },
      evidenceValues: {
        left: '800×600 (declared)',
        right: '800×450 (intrinsic)',
        leftLabel: 'Declared',
        rightLabel: 'Intrinsic',
      },
      internalEvidence: [],
    }),
    buildFinding({
      id: 'fs-49-auto-dims',
      topicId: '49',
      kind: 'performance/img-missing-dimensions',
      verdict: 'auto-set-dimensions',
      severity: 'moderate',
      detail:
        'Missing width/height; intrinsic size readable from image headers — auto-set dimensions.',
      pageUrl: `${origin}/blog/ulez-checker-uk.html`,
      declarationSite: 'generator:autodun-blog-images',
      affectedUrlCount: 1,
      rolledUp: false,
      autoFixable: true,
      reportOnly: false,
      proposedDiff: {
        summary: 'Set width and height from intrinsic size',
        before: '<img src="/images/ulez.png" alt="ULEZ">',
        after: '<img width="640" height="360" src="/images/ulez.png" alt="ULEZ">',
        targetPath: 'generator:autodun-blog-images',
      },
      evidenceValues: null,
      internalEvidence: [],
    }),
    buildFinding({
      id: 'fs-39-d17-a',
      topicId: '39',
      kind: 'structured-data/deprecated-types',
      verdict: 'd17-faq-markup-not-visible',
      severity: 'moderate',
      detail: 'FAQ markup present but corresponding visible FAQ content not found (D17).',
      pageUrl: `${origin}/blog`,
      declarationSite: null,
      affectedUrlCount: 1,
      rolledUp: false,
      autoFixable: false,
      reportOnly: true,
      proposedDiff: null,
      evidenceValues: null,
      internalEvidence: [
        {
          verdict: 'route-topic-39-deprecated',
          detail: 'Related deprecated-type rows routed within topic 39',
        },
      ],
    }),
    buildFinding({
      id: 'fs-39-d17-b',
      topicId: '39',
      kind: 'structured-data/deprecated-types',
      verdict: 'd17-faq-markup-not-visible',
      severity: 'moderate',
      detail: 'FAQ markup present but corresponding visible FAQ content not found (D17).',
      pageUrl: `${origin}/`,
      declarationSite: null,
      affectedUrlCount: 1,
      rolledUp: false,
      autoFixable: false,
      reportOnly: true,
      proposedDiff: null,
      evidenceValues: null,
      internalEvidence: [],
    }),
    buildFinding({
      id: 'fs-34-lang-a',
      topicId: '34',
      kind: 'head/missing-or-wrong-lang',
      verdict: 'low-lang-inlanguage-disagree',
      severity: 'low',
      detail: 'html lang and schema inLanguage disagree.',
      pageUrl: `${origin}/blog`,
      declarationSite: null,
      affectedUrlCount: 1,
      rolledUp: false,
      autoFixable: false,
      reportOnly: true,
      proposedDiff: null,
      evidenceValues: {
        left: 'en',
        right: 'en-GB',
        leftLabel: 'html lang',
        rightLabel: 'inLanguage',
      },
      internalEvidence: [],
    }),
    buildFinding({
      id: 'fs-34-lang-b',
      topicId: '34',
      kind: 'head/missing-or-wrong-lang',
      verdict: 'low-lang-inlanguage-disagree',
      severity: 'low',
      detail: 'html lang and schema inLanguage disagree.',
      pageUrl: `${origin}/`,
      declarationSite: null,
      affectedUrlCount: 1,
      rolledUp: false,
      autoFixable: false,
      reportOnly: true,
      proposedDiff: null,
      evidenceValues: {
        left: 'en',
        right: 'en-GB',
        leftLabel: 'html lang',
        rightLabel: 'inLanguage',
      },
      internalEvidence: [],
    }),
    buildFinding({
      id: 'fs-25-out-of-scope',
      topicId: '25',
      kind: 'sitemap/xml-invalid',
      verdict: 'moderate-out-of-scope',
      severity: 'moderate',
      detail:
        'loc host mot.autodun.com outside sitemap host autodun.com (S5/S6)',
      pageUrl: `${origin}/sitemap.xml`,
      declarationSite: null,
      affectedUrlCount: 1,
      rolledUp: false,
      autoFixable: false,
      reportOnly: true,
      proposedDiff: null,
      evidenceValues: null,
      internalEvidence: [],
    }),
    buildFinding({
      id: 'fs-43-orphan-sitemap',
      topicId: '43',
      kind: 'internal-links/orphan-pages',
      verdict: 'finding-orphan-in-sitemap-lower',
      severity: 'moderate',
      detail:
        'Orphaned in the link graph but listed in the XML sitemap — discovery is not blocked (N8, N9); sitemap does not close the graph orphan.',
      pageUrl: `${origin}/blog`,
      declarationSite: null,
      affectedUrlCount: 1,
      rolledUp: false,
      autoFixable: false,
      reportOnly: true,
      proposedDiff: null,
      evidenceValues: null,
      internalEvidence: [
        {
          verdict: 'route-topic-43-depth-undefined',
          detail:
            'Depth undefined (no inbound crawlable path from homepage) — topic 43, not infinite depth',
          pageUrl: `${origin}/blog`,
        },
        {
          verdict: 'suppress-homepage',
          detail: 'Homepage excluded from orphan findings',
        },
      ],
    }),
  ]

  const informational: UiFinding[] = []
  for (let i = 0; i < 10; i++) {
    informational.push(
      buildFinding({
        id: `fs-35-rec-${i}`,
        topicId: '35',
        kind: 'structured-data/required-properties-absent',
        verdict: 'informational-recommended-absent',
        severity: 'informational',
        detail: `Recommended Article property absent on page ${i + 1} (informational — not a defect).`,
        pageUrl: `${origin}/blog/sample-${i}.html`,
        declarationSite: null,
        affectedUrlCount: 1,
        rolledUp: false,
        autoFixable: false,
        reportOnly: true,
        proposedDiff: null,
        evidenceValues: null,
        internalEvidence: [
          {
            verdict: 'suppress-article-recommended-only',
            detail: 'Recommended-only properties do not raise as defects',
          },
        ],
      }),
    )
  }
  for (let i = 0; i < 7; i++) {
    informational.push(
      buildFinding({
        id: `fs-39-dep-${i}`,
        topicId: '39',
        kind: 'structured-data/deprecated-types',
        verdict: 'informational-deprecated-type',
        severity: 'informational',
        detail: `Deprecated schema type observed (informational) — sample ${i + 1}.`,
        pageUrl: `${origin}/blog`,
        declarationSite: null,
        affectedUrlCount: 1,
        rolledUp: false,
        autoFixable: false,
        reportOnly: true,
        proposedDiff: null,
        evidenceValues: null,
        internalEvidence: [],
      }),
    )
  }

  return [...actionable, ...informational]
}

export const DEMO_RUN_META = {
  origin: 'https://autodun.com',
  crawledAt: '2026-09-17T08:00:00.000Z',
  demo: true as const,
  /** Internal rows from the live audit — not listed; count for UI chrome. */
  internalCount: 349,
}
