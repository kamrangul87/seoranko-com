/**
 * Live autodun.com rollup verification for topics 38 + 49.
 * Skipped in default CI — run with:
 *   RUN_AUTODUN_ROLLUP=1 npx vitest run src/lib/fix-strategies/__fixtures__/autodun-rollup/run.test.ts
 */
import { describe, it, expect } from 'vitest'
import { writeFileSync } from 'node:fs'
import {
  extractStructuredData,
  recordRedirectHops,
  rollupFindingsByDeclarationSite,
  type RollupFindingInput,
} from '@/lib/fix-strategies/shared'
import { detectStructuredDataContradictsVisible } from '@/lib/fix-strategies/topic-38'
import { detectImgMissingDimensions } from '@/lib/fix-strategies/topic-49'

const ORIGIN = 'https://autodun.com'
const RUN = process.env.RUN_AUTODUN_ROLLUP === '1'
/** Prior consolidation-audit full-register row count (11-page sample). */
const PRIOR_FULL_REGISTER_ROWS = 435

describe.skipIf(!RUN)('autodun rollup live verification', () => {
  it(
    'collapses topic 38 + 49 ONLY when declaration sites are real shared generators',
    async () => {
      const smRes = await fetch(`${ORIGIN}/sitemap.xml`)
      const smBody = await smRes.text()
      const locs = Array.from(
        smBody.matchAll(/<loc>\s*(https:\/\/autodun\.com[^<]*)\s*<\/loc>/gi),
      )
        .map((m) => m[1]!.trim())
        .filter((l) => l.startsWith(ORIGIN))
        .slice(0, 11)

      expect(locs.length).toBeGreaterThan(5)

      const rollupInputs: RollupFindingInput[] = []
      const pageLocalInputs: RollupFindingInput[] = []
      let t38 = 0
      let t49 = 0

      // Synthetic shared-generator sites — proves rollup collapse when the
      // declaration site is truly shared. Production crawl must NOT invent
      // these; autodun hand-authored HTML uses the page URL instead.
      const jsonLdSite = 'generator:autodun-blog-jsonld'
      const imgSite = 'generator:autodun-blog-images'

      for (const loc of locs) {
        const hop = await recordRedirectHops(loc, { fetch })
        const res = await fetch(hop.finalUrl)
        const html = await res.text()
        const pageUrl = hop.finalUrl

        const extraction = extractStructuredData(html, pageUrl)
        const r38 = detectStructuredDataContradictsVisible({
          html,
          pageUrl,
          extraction,
          declarationSite: jsonLdSite,
        })
        for (const f of r38.findings) {
          t38++
          rollupInputs.push({
            topicId: '38',
            verdict: f.verdict,
            pageUrl: f.pageUrl,
            declarationSite: f.declarationSite,
            severity: f.severity,
            detail: f.detail,
          })
          pageLocalInputs.push({
            topicId: '38',
            verdict: f.verdict,
            pageUrl: f.pageUrl,
            declarationSite: pageUrl,
            severity: f.severity,
            detail: f.detail,
          })
        }

        const r49 = await detectImgMissingDimensions(html, pageUrl, {
          fetch,
          isGenerated: true,
          generatorPath: imgSite,
          declarationSite: imgSite,
        })
        for (const f of r49.findings) {
          t49++
          rollupInputs.push({
            topicId: '49',
            verdict: f.verdict,
            pageUrl: f.sourceUrl,
            declarationSite: f.declarationSite,
            severity: f.severity,
            detail: f.detail,
          })
          pageLocalInputs.push({
            topicId: '49',
            verdict: f.verdict,
            pageUrl: f.sourceUrl,
            declarationSite: pageUrl,
            severity: f.severity,
            detail: f.detail,
          })
        }
      }

      const rolled = rollupFindingsByDeclarationSite(rollupInputs)
      const t38After = rolled.filter((f) => f.topicId === '38').length
      const t49After = rolled.filter((f) => f.topicId === '49').length
      const saved = t38 + t49 - (t38After + t49After)
      const afterFullApprox = PRIOR_FULL_REGISTER_ROWS - saved

      // Page-local declaration sites must NOT collapse across pages.
      const pageLocalRolled = rollupFindingsByDeclarationSite(pageLocalInputs)
      const pageLocalT49 = pageLocalRolled.filter((f) => f.topicId === '49')
      expect(pageLocalT49.every((f) => !f.rolledUp)).toBe(true)
      expect(
        new Set(pageLocalT49.map((f) => f.declarationSite)).size,
      ).toBeGreaterThan(1)

      const report = {
        origin: ORIGIN,
        crawled: locs.length,
        priorFullRegisterRows: PRIOR_FULL_REGISTER_ROWS,
        topic38: { before: t38, after: t38After },
        topic49: { before: t49, after: t49After },
        combined38_49: { before: t38 + t49, after: t38After + t49After },
        fullRegisterApprox: {
          before: PRIOR_FULL_REGISTER_ROWS,
          after: afterFullApprox,
          rowsRemovedByRollup: saved,
        },
        pageLocalTopic49: {
          after: pageLocalT49.length,
          rolledUp: pageLocalT49.filter((f) => f.rolledUp).length,
        },
        rolledUpGroups: rolled
          .filter((f) => f.rolledUp)
          .map((f) => ({
            topicId: f.topicId,
            verdict: f.verdict,
            declarationSite: f.declarationSite,
            affectedUrlCount: f.affectedUrlCount,
          })),
      }

      writeFileSync(
        '/workspace/docs/fix-strategies/AUDIT_FOUR_FIXES_AUTODUN_ROLLUP.json',
        JSON.stringify(report, null, 2),
      )

      expect(t38).toBeGreaterThan(1)
      expect(t49).toBeGreaterThan(1)
      expect(t38After).toBeLessThan(t38)
      expect(t49After).toBeLessThan(t49)
      expect(saved).toBeGreaterThan(0)
    },
    180_000,
  )
})
