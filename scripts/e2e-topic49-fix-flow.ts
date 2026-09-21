/**
 * E2E: apply topic 49 auto-set-dimensions on autodun mot-advisories page
 * via real PR (not main) → wait for Vercel preview → live verify.
 *
 * Requires:
 *   GITHUB_TOKEN or AUTODUN_GITHUB_TOKEN with Contents+PR write on
 *   kamrangul87/autodun-ai
 *
 * Run:
 *   GITHUB_TOKEN=… npx tsx scripts/e2e-topic49-fix-flow.ts
 */

import { randomUUID } from 'node:crypto'
import {
  useMemoryFixFlowStore,
  resetMemoryFixFlowStore,
} from '../src/lib/fix-strategies/findings-ui/fix-flow/persist'
import {
  approveFix,
  commitFix,
  verifyFix,
} from '../src/lib/fix-strategies/findings-ui/fix-flow/orchestrate'
import type { PersistedFindingRow } from '../src/lib/fix-strategies/findings-ui/crawl/constants'

const OWNER = process.env.FINDINGS_FIX_OWNER || 'kamrangul87'
const REPO = process.env.FINDINGS_FIX_REPO || 'autodun-ai'
const PAGE_URL =
  process.env.FINDINGS_FIX_PAGE_URL ||
  'https://autodun.com/blog/mot-advisories-explained-uk.html'
const PATH =
  process.env.FINDINGS_FIX_PATH ||
  'public/blog/mot-advisories-explained-uk.html'

async function main() {
  const token =
    process.env.AUTODUN_GITHUB_TOKEN?.trim() ||
    process.env.GITHUB_TOKEN?.trim() ||
    process.env.FINDINGS_FIX_GITHUB_TOKEN?.trim()
  if (!token) {
    console.error(
      'Set GITHUB_TOKEN (Contents:write + Pull requests:write on the target repo).',
    )
    process.exit(1)
  }

  resetMemoryFixFlowStore()
  useMemoryFixFlowStore()

  const findingId = randomUUID()
  const userId = randomUUID()
  const finding: PersistedFindingRow = {
    id: findingId,
    siteId: null,
    detectOrigin: 'https://autodun.com',
    userId,
    topicId: '49',
    kind: 'performance/img-missing-dimensions',
    bucket: 'actionable',
    verdict: 'auto-set-dimensions',
    severity: 'moderate',
    rollupKey: `49|auto-set-dimensions|${PAGE_URL}`,
    declarationSite: 'generator:autodun-blog-images',
    affectedUrlCount: 1,
    pageUrl: PAGE_URL,
    detail: 'One dimension absent — set both from image header',
    autoFixable: true,
    reportOnly: false,
    surfaceClass: 'auto-fixable',
    proposedDiff: {
      summary: 'Set width/height from intrinsic headers',
    },
    evidenceValues: null,
    sourceRows: [],
    firstSeenRunId: null,
    lastSeenRunId: null,
    firstSeenAt: new Date().toISOString(),
    lastSeenAt: new Date().toISOString(),
  }

  console.log('1. Approve…')
  const approved = await approveFix(findingId, userId)
  console.log('   step=', approved.step)

  console.log('2. Commit via PR (not main)…')
  const committed = await commitFix({
    findingId,
    userId,
    finding,
    ctx: {
      github: { owner: OWNER, repo: REPO, baseBranch: 'main', accessToken: token },
      pathOverride: PATH,
    },
  })
  console.log('   step=', committed.step)
  console.log('   detail=', committed.commitDetail)
  console.log('   pr=', committed.prUrl)
  console.log('   branch=', committed.branchName)
  console.log('   sha=', committed.commitSha)
  if (committed.step !== 'committed' || !committed.prUrl) {
    process.exit(1)
  }

  console.log('3. Wait for Vercel preview + live verify…')
  const verified = await verifyFix({
    findingId,
    userId,
    finding,
    ctx: {
      github: { owner: OWNER, repo: REPO, baseBranch: 'main', accessToken: token },
    },
    timeoutMs: 10 * 60 * 1000,
  })
  console.log('   step=', verified.step)
  console.log('   preview=', verified.previewUrl)
  console.log('   verifyOk=', verified.verifyOk)
  console.log('   detail=', verified.verifyDetail)

  console.log('\n=== REPORT ===')
  console.log(JSON.stringify({
    prUrl: verified.prUrl ?? committed.prUrl,
    prNumber: verified.prNumber ?? committed.prNumber,
    branchName: verified.branchName ?? committed.branchName,
    commitSha: verified.commitSha ?? committed.commitSha,
    previewUrl: verified.previewUrl,
    verifyOk: verified.verifyOk,
    verifyDetail: verified.verifyDetail,
    step: verified.step,
  }, null, 2))

  if (!verified.verifyOk) process.exit(2)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
