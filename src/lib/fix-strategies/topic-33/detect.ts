/**
 * Topic 33 — duplicate titles / descriptions across distinct URLs.
 *
 * MANDATORY first step: EXCLUSION of duplicate URL variants (topics 8–12)
 * and pages that canonicalise to one another (13–18). Never propose title
 * changes for those groups.
 *
 * Twenty pages inheriting one layout title → ONE finding naming the component.
 * No ranking penalty claim (H27). No content generation.
 */

import type { HeadInspection } from '@/lib/fix-strategies/shared/head-inspect'
import {
  generateVariant,
  type DuplicateUrlStrategy,
} from '@/lib/fix-strategies/shared/duplicate-url-variants'
import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared/url-normalize'
import {
  resolveFixTarget,
  type FixTargetResult,
} from '@/lib/fix-strategies/shared'

const VARIANT_STRATEGIES: DuplicateUrlStrategy[] = [
  'trailing-slash',
  'index-html',
  'http-https',
  'www-non-www',
  'path-case',
  'query-params',
]

export type Topic33Verdict =
  | 'report-duplicate-titles'
  | 'report-duplicate-descriptions'
  | 'report-sitewide-description'
  | 'report-boilerplate-title'
  | 'route-topic-8-12-url-variants'
  | 'route-topic-13-18-canonical-group'
  | 'suppress-paginated'
  | 'suppress-not-identical'
  | 'suppress-not-indexable'

export type Topic33Finding = {
  kind: 'head/duplicate-titles-descriptions'
  verdict: Topic33Verdict
  severity: 'moderate' | 'low' | null
  /** Shared title or description value. */
  value: string
  field: 'title' | 'description'
  memberUrls: string[]
  /** Single declaration site when known (layout / helper). */
  declarationSite: string | null
  detail: string
  autoFixable: false
  /** Never claim a ranking penalty. */
  rankingPenaltyClaimed: false
  fixTarget: FixTargetResult
}

export type DetectTopic33Page = {
  url: string
  inspection: HeadInspection
  indexable: boolean
  /** Canonical target if declared (normalized). */
  canonicalTarget?: string | null
  paginated?: boolean
  /** Shared layout / metadata helper path. */
  declarationSite?: string | null
}

export type DetectTopic33Result = {
  findings: Topic33Finding[]
  routed: Array<{
    verdict: Topic33Verdict
    memberUrls: string[]
    detail: string
  }>
  suppressed: Array<{ verdict: Topic33Verdict; detail: string }>
}

export type DetectTopic33Options = {
  pages: DetectTopic33Page[]
  artefactPath?: string
  isGenerated?: boolean
  generatorPath?: string | null
}

/**
 * True when every URL in the group is a duplicate-URL variant of every other
 * (topics 8–12), i.e. the shared title is a symptom of URL duplication.
 */
export function groupIsUrlVariantCluster(urls: string[]): boolean {
  if (urls.length < 2) return false
  const norms = urls
    .map((u) => normalizeFixStrategyUrl(u) ?? u)
    .filter(Boolean)
  // Every pair must be related by some variant strategy
  for (let i = 0; i < norms.length; i++) {
    for (let j = i + 1; j < norms.length; j++) {
      if (!areUrlVariants(norms[i]!, norms[j]!)) return false
    }
  }
  return true
}

function areUrlVariants(a: string, b: string): boolean {
  if (a === b) return true
  for (const strategy of VARIANT_STRATEGIES) {
    const pair = generateVariant(a, strategy, {
      uppercaseHint: b,
    })
    if (!pair) continue
    const pb = normalizeFixStrategyUrl(pair.b) ?? pair.b
    const pa = normalizeFixStrategyUrl(pair.a) ?? pair.a
    if (pb === b || pa === b) return true
    if (strategy === 'query-params' && pair.cleanUrl) {
      const clean = normalizeFixStrategyUrl(pair.cleanUrl) ?? pair.cleanUrl
      if (clean === b || clean === a) return true
    }
  }
  // Also try b → a
  for (const strategy of VARIANT_STRATEGIES) {
    const pair = generateVariant(b, strategy, { uppercaseHint: a })
    if (!pair) continue
    const pb = normalizeFixStrategyUrl(pair.b) ?? pair.b
    if (pb === a) return true
  }
  return false
}

/** True when members share one canonical target or cross-canonicalise within the group. */
export function groupIsCanonicalCluster(pages: DetectTopic33Page[]): boolean {
  const pairs = pages.map((p) => {
    const self = normalizeFixStrategyUrl(p.url)
    const canon =
      p.canonicalTarget != null
        ? normalizeFixStrategyUrl(p.canonicalTarget)
        : self
    return { self, canon: canon ?? self }
  })
  if (pairs.some((p) => p.self == null)) return false

  const targets = new Set(pairs.map((p) => p.canon!))
  // All point at the same canonical URL
  if (targets.size === 1) return true

  // Cross-canonical within the group (at least one non-self)
  const urlSet = new Set(pairs.map((p) => p.self!))
  const allTargetsInGroup = [...targets].every((t) => urlSet.has(t))
  const anyNonSelf = pairs.some((p) => p.self !== p.canon)
  return allTargetsInGroup && anyNonSelf
}

export function detectDuplicateTitlesDescriptions(
  options: DetectTopic33Options,
): DetectTopic33Result {
  const findings: Topic33Finding[] = []
  const routed: DetectTopic33Result['routed'] = []
  const suppressed: DetectTopic33Result['suppressed'] = []
  const fixTarget = resolveFixTarget({
    artefactPath: options.artefactPath ?? 'app/layout.tsx',
    isGenerated: options.isGenerated ?? false,
    generatorPath: options.generatorPath ?? null,
  })

  const indexable = options.pages.filter((p) => p.indexable)
  if (indexable.length < 2) {
    suppressed.push({
      verdict: 'suppress-not-indexable',
      detail: 'Fewer than two indexable pages to compare',
    })
    return { findings, routed, suppressed }
  }

  // Group by title (do NOT case-fold)
  const byTitle = new Map<string, DetectTopic33Page[]>()
  const byDesc = new Map<string, DetectTopic33Page[]>()

  for (const page of indexable) {
    const title = page.inspection.titlesInHead[0]?.normalized ?? ''
    if (title) {
      const list = byTitle.get(title) ?? []
      list.push(page)
      byTitle.set(title, list)
    }
    const desc = page.inspection.descriptionsInHead[0]?.normalized ?? ''
    if (desc) {
      const list = byDesc.get(desc) ?? []
      list.push(page)
      byDesc.set(desc, list)
    }
  }

  const emitGroups = (
    groups: Map<string, DetectTopic33Page[]>,
    field: 'title' | 'description',
  ) => {
    for (const [value, members] of groups) {
      if (members.length < 2) continue
      const urls = members.map((m) => m.url)

      // MANDATORY exclusion: URL variants
      if (groupIsUrlVariantCluster(urls)) {
        routed.push({
          verdict: 'route-topic-8-12-url-variants',
          memberUrls: urls,
          detail: `Identical ${field} on URL variants — defect is URL duplication (H28). Never propose ${field} changes.`,
        })
        continue
      }

      // Canonical cluster
      if (groupIsCanonicalCluster(members)) {
        routed.push({
          verdict: 'route-topic-13-18-canonical-group',
          memberUrls: urls,
          detail: `Identical ${field} on pages that canonicalise together — route to canonical block`,
        })
        continue
      }

      // Paginated
      if (members.every((m) => m.paginated)) {
        suppressed.push({
          verdict: 'suppress-paginated',
          detail: `Paginated pages sharing ${field} — often legitimate`,
        })
        continue
      }

      const declarationSite =
        members.map((m) => m.declarationSite).find((s) => s != null) ?? null

      // Site-wide description
      if (field === 'description' && members.length === indexable.length) {
        findings.push({
          kind: 'head/duplicate-titles-descriptions',
          verdict: 'report-sitewide-description',
          severity: 'moderate',
          value,
          field,
          memberUrls: declarationSite ? urls.slice(0, 1) : urls,
          // One finding naming the layout when shared
          declarationSite,
          detail: declarationSite
            ? `Identical description site-wide from ${declarationSite} — one finding (H17). No ranking penalty claim.`
            : `Identical description site-wide across ${urls.length} pages (H17). No ranking penalty claim.`,
          autoFixable: false,
          rankingPenaltyClaimed: false,
          fixTarget,
        })
        continue
      }

      // Boilerplate brand-only title: single token brand repeated (H12)
      const isBoilerplate =
        field === 'title' &&
        value.length > 0 &&
        value.length <= 40 &&
        value.split(/\s+/).filter(Boolean).length === 1

      // Collapse to one finding when shared declaration site
      const memberUrls = declarationSite ? [members[0]!.url] : urls
      const detail = declarationSite
        ? `${members.length} pages inherit identical ${field} from ${declarationSite}. Report once. No ranking penalty (H27). Content generation out of bounds.`
        : `Identical ${field} across ${urls.length} distinct pages. No ranking penalty (H27). Do not generate replacement text.`

      findings.push({
        kind: 'head/duplicate-titles-descriptions',
        verdict: isBoilerplate
          ? 'report-boilerplate-title'
          : field === 'title'
            ? 'report-duplicate-titles'
            : 'report-duplicate-descriptions',
        severity: field === 'title' ? 'moderate' : 'low',
        value,
        field,
        memberUrls: declarationSite ? urls : memberUrls,
        declarationSite,
        detail,
        autoFixable: false,
        rankingPenaltyClaimed: false,
        fixTarget,
      })
    }
  }

  emitGroups(byTitle, 'title')
  emitGroups(byDesc, 'description')

  return { findings, routed, suppressed }
}

export function rejectedGenerateDistinctTitles(): never {
  throw new Error(
    'REJECTED: generating distinct titles/descriptions is content generation and is out of bounds',
  )
}
