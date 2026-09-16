/**
 * Topic 26 — apply auto-fixable sitemap edits.
 * Must not be imported by the verifier.
 */

import { resolveFixTarget } from '../shared/generated-output-guard'
import type { Topic26Finding } from './detect'
import { removeSitemapLoc, replaceSitemapLoc } from './parse-sitemap'

export type Topic26FixPlan = {
  /** Where the edit must land. */
  targetPath: string | null
  action: 'fix-generator' | 'fix-artefact' | 'human-review' | 'noop'
  reason: string
  /** Artefact XML after applying auto-fixes (empty when generator-only / review). */
  nextSitemapXml: string | null
  applied: Array<{ loc: string; verdict: Topic26Finding['verdict']; note: string }>
  deferred: Topic26Finding[]
}

const AUTO_REMOVE = new Set<Topic26Finding['verdict']>([
  'auto-remove-confirmed-4xx',
  'auto-remove-repo-noindex',
  'auto-remove-injected-noindex',
])

/**
 * Build a fix plan from detections. When the sitemap is generated, the plan
 * targets the generator and does not rewrite emitted XML.
 */
export function planSitemapFixes(
  sitemapXml: string,
  findings: Topic26Finding[],
  opts: {
    artefactPath: string
    isGenerated: boolean
    generatorPath: string | null
  },
): Topic26FixPlan {
  const target = resolveFixTarget(opts)
  const auto = findings.filter(
    (f) =>
      AUTO_REMOVE.has(f.verdict) ||
      f.verdict === 'auto-replace-single-hop-redirect',
  )
  const deferred = findings.filter((f) => !auto.includes(f))

  if (target.action === 'human-review') {
    return {
      targetPath: null,
      action: 'human-review',
      reason: target.reason,
      nextSitemapXml: null,
      applied: [],
      deferred: findings,
    }
  }

  if (target.action === 'fix-generator') {
    return {
      targetPath: target.targetPath,
      action: 'fix-generator',
      reason: target.reason,
      // Never edit emitted XML — generator must emit the corrected set.
      nextSitemapXml: null,
      applied: auto.map((f) => ({
        loc: f.loc,
        verdict: f.verdict,
        note:
          f.verdict === 'auto-replace-single-hop-redirect'
            ? `Generator must emit ${f.replaceWith} instead of ${f.loc}`
            : `Generator must omit ${f.loc}`,
      })),
      deferred,
    }
  }

  let xml = sitemapXml
  const applied: Topic26FixPlan['applied'] = []

  for (const f of auto) {
    if (AUTO_REMOVE.has(f.verdict)) {
      const { xml: next, removed } = removeSitemapLoc(xml, f.loc)
      if (removed > 0) {
        xml = next
        applied.push({
          loc: f.loc,
          verdict: f.verdict,
          note: `Removed ${removed} url block(s)`,
        })
      }
      continue
    }
    if (f.verdict === 'auto-replace-single-hop-redirect' && f.replaceWith) {
      const { xml: next, replaced } = replaceSitemapLoc(xml, f.loc, f.replaceWith)
      if (replaced > 0) {
        xml = next
        applied.push({
          loc: f.loc,
          verdict: f.verdict,
          note: `Replaced loc with ${f.replaceWith}`,
        })
      }
    }
  }

  return {
    targetPath: target.targetPath,
    action: applied.length > 0 ? 'fix-artefact' : 'noop',
    reason: target.reason,
    nextSitemapXml: xml,
    applied,
    deferred,
  }
}
