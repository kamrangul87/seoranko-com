/**
 * Advance one Fix Agent run tick (resumable — mirrors crawl start/tick).
 */

import {
  customerWriteGateUserMessage,
  isCustomerWriteGateError,
  withCustomerWriteGate,
} from '@/lib/customer-write-gate'
import { getFindingsStore } from '../crawl/store'
import type { PersistedFindingRow } from '../crawl/constants'
import {
  applyRegisteredTransform,
  resolveTransformPath,
  resolveVerifyUrl,
  verifyRegisteredTransform,
} from './apply-registry'
import {
  allRemainingPreviewVerified,
  canMergeRun,
  computeSummary,
  deriveRunStatus,
  itemsNeedingApply,
  itemsNeedingPreviewVerify,
  itemsNeedingProductionVerify,
  markItemCommitted,
  markItemFailed,
  nextPhaseAfterApply,
  nextPhaseAfterPreviewVerify,
  progressLabel,
} from './phases'
import { getFixRunStore } from './store'
import type { FixRun, FixRunPublicState } from './types'
import type { GithubOps, GithubPrCreds } from './github-ops'
import { createLiveGithubOps, isPlaceholderPreviewUrl } from './github-ops'
import { appendOutcomeRecordLocal } from '../fix-flow/outcome-record'
import {
  evaluateAutoMergeVerdictGate,
  resolveSiteAutoMergeEnabled,
} from '../fix-flow/auto-merge'
import { assessSingleFileBlastRadius } from '../fix-flow/blast-radius'

/** Branch / commit / PR writes — same purpose as per-finding fix-flow. */
function withFixRunPrGate<T>(fn: () => Promise<T>): Promise<T> {
  return withCustomerWriteGate('findings-pr-branch', { approved: true }, fn)
}

/** Merge after approval or auto-merge gates — same purpose as per-finding auto-merge. */
function withFixRunMergeGate<T>(fn: () => Promise<T>): Promise<T> {
  return withCustomerWriteGate(
    'findings-auto-merge',
    { autoMergeGatesOk: true },
    fn,
  )
}

export type TickDeps = {
  ops: GithubOps
  creds: GithubPrCreds
  /** Fetch HTML for preview/production verify. */
  fetchPage: (url: string) => Promise<{ ok: boolean; body: string; status: number }>
  /** Production site origin e.g. https://autodun.com */
  siteOrigin: string
  autoMergeEnabledOverride?: boolean | null
  /** Soft deadline — stop after one micro-step when exceeded (ms). */
  deadlineMs?: number
  /** Optional recrawl hook after production verify. */
  startRecrawl?: (siteId: string) => Promise<void>
  now?: () => string
}

export type TickResult = {
  run: FixRunPublicState
  advanced: boolean
  detail: string
}

function toPublic(run: FixRun): FixRunPublicState {
  const allPreview = allRemainingPreviewVerified(run.items)
  return {
    ...run,
    canApproveMerge:
      run.phase === 'await_approval' && allPreview && !run.approvedAt,
    progressLabel: progressLabel(run),
  }
}

async function loadFindingMap(
  findingIds: string[],
): Promise<Map<string, PersistedFindingRow>> {
  const store = getFindingsStore()
  const map = new Map<string, PersistedFindingRow>()
  for (const id of findingIds) {
    const f = await store.getFinding(id)
    if (f) map.set(id, f)
  }
  return map
}

function previewPageUrl(previewBase: string, pageUrl: string | null): string {
  if (!pageUrl) return previewBase
  try {
    const u = new URL(pageUrl)
    return `${previewBase.replace(/\/$/, '')}${u.pathname}${u.search}`
  } catch {
    return previewBase
  }
}

/** Stored on prevContents when wait_preview begins — drives tick timeout. */
const PREVIEW_WAIT_STARTED_KEY = '__previewWaitStartedAt'
/** Bounded wait for a real preview URL signal (deployments / status / comment). */
const PREVIEW_WAIT_TIMEOUT_MS = 15 * 60 * 1000
/** Stored when production deploy wait begins after merge. */
const PROD_DEPLOY_WAIT_STARTED_KEY = '__productionDeployWaitStartedAt'
/** Set once production deploy for mergeSha is READY — then items may verify. */
const PROD_DEPLOY_READY_KEY = '__productionDeployReady'
/** Same bound as preview wait — fail remaining prod verifies if exceeded. */
const PROD_DEPLOY_WAIT_TIMEOUT_MS = 15 * 60 * 1000

function previewWaitStartedAt(run: FixRun): number | null {
  const raw = run.prevContents[PREVIEW_WAIT_STARTED_KEY]
  if (!raw) return null
  const ms = Date.parse(raw)
  return Number.isFinite(ms) ? ms : null
}

function productionPageUrl(origin: string, pageUrl: string | null): string {
  if (!pageUrl) return origin
  try {
    const u = new URL(pageUrl)
    return `${origin.replace(/\/$/, '')}${u.pathname}${u.search}`
  } catch {
    return origin
  }
}

/**
 * Registry preview/production check against a re-fetched body.
 * Never mark verified without a successful re-fetch (caller must fetch first).
 */
async function verifyBodyForFinding(
  finding: PersistedFindingRow,
  body: string,
  liveUrl: string,
  stage: 'preview' | 'production',
  fetchImpl?: typeof fetch,
): Promise<{ ok: boolean; detail: string }> {
  return verifyRegisteredTransform({
    finding,
    body,
    liveUrl,
    stage,
    fetchImpl,
  })
}

export async function tickFixRun(input: {
  runId: string
  userId: string
  deps: TickDeps
}): Promise<TickResult> {
  const store = getFixRunStore()
  let run = await store.getRun(input.runId, input.userId)
  if (!run) {
    throw new Error('Run not found')
  }
  if (run.phase === 'done') {
    return { run: toPublic(run), advanced: false, detail: 'already done' }
  }

  const now = input.deps.now?.() ?? new Date().toISOString()
  const findings = await loadFindingMap(run.items.map((i) => i.findingId))
  const { ops, creds } = input.deps
  let detail = 'noop'
  let advanced = false

  const save = async () => {
    const current = run!
    current.status = deriveRunStatus(
      current.phase,
      current.items,
      current.errorDetail,
    )
    current.summary = computeSummary(current.items)
    run = await store.saveRun(current)
  }

  // ── create_branch ───────────────────────────────────────────────
  if (run.phase === 'create_branch') {
    if (!run.branchName) {
      run.branchName = `seoranko/fix-run-${Date.now().toString(36)}`
    }
    const branchName = run.branchName
    let created: Awaited<ReturnType<GithubOps['createBranch']>>
    try {
      created = await withFixRunPrGate(() =>
        ops.createBranch({
          creds,
          branchName,
        }),
      )
    } catch (err) {
      const msg = isCustomerWriteGateError(err)
        ? customerWriteGateUserMessage(err)
        : err instanceof Error
          ? err.message
          : 'create_branch failed'
      run.phase = 'done'
      run.status = 'failed'
      run.errorDetail = isCustomerWriteGateError(err)
        ? customerWriteGateUserMessage(err)
        : msg
      await save()
      return {
        run: toPublic(run),
        advanced: true,
        detail: `create_branch failed: ${run.errorDetail}`,
      }
    }
    if (!created.ok) {
      run.phase = 'done'
      run.status = 'failed'
      run.errorDetail = created.error
      await save()
      return {
        run: toPublic(run),
        advanced: true,
        detail: `create_branch failed: ${created.error}`,
      }
    }
    console.info('[fix-run] branch created', {
      runId: run.id,
      branchName: run.branchName,
    })
    run.phase = 'apply_next'
    run.status = 'running'
    advanced = true
    detail = 'branch created'
    await save()
    return { run: toPublic(run), advanced, detail }
  }

  // ── apply_next ──────────────────────────────────────────────────
  if (run.phase === 'apply_next') {
    const next = itemsNeedingApply(run.items)[0]
    if (!next) {
      run.phase = nextPhaseAfterApply(run.items)
      advanced = true
      detail = 'no more items to apply'
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    const finding = findings.get(next.findingId)
    if (!finding) {
      const idx = run.items.findIndex((i) => i.id === next.id)
      // Leave out of the run (noop) — not a failed apply.
      run.items[idx] = {
        ...next,
        status: 'noop',
        failureReason: 'Finding row missing — left out of run',
        updatedAt: now,
      }
      console.info('[fix-run] apply skip', {
        runId: run.id,
        findingId: next.findingId,
        reason: 'finding missing',
      })
      advanced = true
      detail = `item ${next.findingId} left out: finding missing`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    // Re-check stored source before apply — never fail an item for missing path.
    if (!finding.sourcePath || !finding.sourceBlobSha) {
      const idx = run.items.findIndex((i) => i.id === next.id)
      const reason =
        finding.sourceUnresolvedReason ||
        'No stored source_path/source_blob_sha — left out of run'
      run.items[idx] = {
        ...next,
        status: 'noop',
        failureReason: reason,
        updatedAt: now,
      }
      console.info('[fix-run] apply skip', {
        runId: run.id,
        findingId: next.findingId,
        reason,
      })
      advanced = true
      detail = `item ${next.findingId} left out: unresolved source`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    const path = resolveTransformPath(finding)
    if (!path || !run.branchName) {
      const idx = run.items.findIndex((i) => i.id === next.id)
      const reason = path
        ? 'Branch missing — left out of run'
        : 'Cannot resolve repo path for finding — left out of run'
      run.items[idx] = {
        ...next,
        status: 'noop',
        failureReason: reason,
        updatedAt: now,
      }
      advanced = true
      detail = `item ${next.findingId} left out: path`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    const idx = run.items.findIndex((i) => i.id === next.id)
    run.items[idx] = { ...next, status: 'applying', updatedAt: now }
    await save()

    const read = await ops.readFile({
      creds,
      path,
      ref: run.branchName,
    })
    if (!read.ok) {
      run.items[idx] = markItemFailed(run.items[idx]!, read.error, now)
      advanced = true
      detail = `item ${next.findingId} failed read: ${read.error}`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    const previousContent = read.content
    const applied = await applyRegisteredTransform({
      fileContent: read.content,
      path,
      finding,
    })

    if (!applied.ok) {
      run.items[idx] = markItemFailed(run.items[idx]!, applied.error, now)
      console.info('[fix-run] transform failed', {
        runId: run.id,
        findingId: next.findingId,
        error: applied.error,
      })
      advanced = true
      detail = `item ${next.findingId} transform failed`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    if (applied.noop || applied.updated === 0) {
      run.items[idx] = {
        ...run.items[idx]!,
        status: 'noop',
        path,
        failureReason: null,
        updatedAt: now,
      }
      console.info('[fix-run] apply noop', {
        runId: run.id,
        findingId: next.findingId,
        path,
      })
      advanced = true
      detail = `item ${next.findingId} noop`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    const commitBranch = run.branchName!
    let committed: Awaited<ReturnType<GithubOps['commitFile']>>
    try {
      committed = await withFixRunPrGate(() =>
        ops.commitFile({
          creds,
          path: applied.path,
          content: applied.newContent,
          branchName: commitBranch,
          message: `fix(seo): ${finding.topicId} ${finding.verdict} (${finding.id.slice(0, 8)})`,
        }),
      )
    } catch (err) {
      const failMsg = isCustomerWriteGateError(err)
        ? customerWriteGateUserMessage(err)
        : err instanceof Error
          ? err.message
          : 'commit failed'
      run.items[idx] = markItemFailed(run.items[idx]!, failMsg, now)
      advanced = true
      detail = `item ${next.findingId} commit failed`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    if (!committed.ok) {
      // Transform failed at commit — nothing to revert on branch
      run.items[idx] = markItemFailed(run.items[idx]!, committed.error, now)
      console.info('[fix-run] commit failed', {
        runId: run.id,
        findingId: next.findingId,
        error: committed.error,
      })
      advanced = true
      detail = `item ${next.findingId} commit failed`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    run.items[idx] = markItemCommitted(
      run.items[idx]!,
      committed.commitSha,
      applied.path,
      now,
    )
    run.prevContents = {
      ...(run.prevContents || {}),
      [next.id]: previousContent,
    }

    console.info('[fix-run] committed', {
      runId: run.id,
      findingId: next.findingId,
      commitSha: committed.commitSha,
      path: applied.path,
    })
    advanced = true
    detail = `item ${next.findingId} committed`
    await save()
    return { run: toPublic(run), advanced, detail }
  }

  // ── ensure_pr ───────────────────────────────────────────────────
  if (run.phase === 'ensure_pr') {
    if (!run.branchName) {
      run.phase = 'done'
      run.status = 'failed'
      run.errorDetail = 'No branch for PR'
      await save()
      return { run: toPublic(run), advanced: true, detail: 'no branch' }
    }
    const anyCommit = run.items.some((i) => i.status === 'committed')
    if (!anyCommit) {
      run.phase = 'done'
      run.status = computeSummary(run.items).failed === run.items.length
        ? 'failed'
        : 'complete'
      detail = 'nothing to PR'
      await save()
      return { run: toPublic(run), advanced: true, detail }
    }
    const prBranch = run.branchName!
    const prRunId = run.id
    const prItems = run.items
    let pr: Awaited<ReturnType<GithubOps['ensurePullRequest']>>
    try {
      pr = await withFixRunPrGate(() =>
        ops.ensurePullRequest({
          creds,
          branchName: prBranch,
          title: `SEORANKO fix run: ${prItems.length} auto-fixable finding(s)`,
          body: [
            '## SEORANKO one-run Fix Agent',
            '',
            `Run \`${prRunId}\` — one branch, one PR, one commit per fix.`,
            '',
            'All edits are deterministic transforms. No model-generated code.',
            '',
            '### Items',
            ...prItems.map(
              (i) =>
                `- \`${i.findingId}\` — ${i.status}${i.commitSha ? ` (\`${i.commitSha.slice(0, 7)}\`)` : ''}${i.failureReason ? ` — ${i.failureReason}` : ''}`,
            ),
          ].join('\n'),
        }),
      )
    } catch (err) {
      const failMsg = isCustomerWriteGateError(err)
        ? customerWriteGateUserMessage(err)
        : err instanceof Error
          ? err.message
          : 'PR open failed'
      run.errorDetail = failMsg
      run.phase = 'done'
      run.status = 'failed'
      await save()
      return { run: toPublic(run), advanced: true, detail: failMsg }
    }
    if (!pr.ok) {
      run.errorDetail = pr.error
      run.phase = 'done'
      run.status = 'failed'
      await save()
      return { run: toPublic(run), advanced: true, detail: pr.error }
    }
    run.prNumber = pr.prNumber
    run.prUrl = pr.prUrl
    run.phase = 'wait_preview'
    advanced = true
    detail = `PR #${pr.prNumber}`
    console.info('[fix-run] PR open', {
      runId: run.id,
      prNumber: pr.prNumber,
      prUrl: pr.prUrl,
    })
    await save()
    return { run: toPublic(run), advanced, detail }
  }

  // ── wait_preview ────────────────────────────────────────────────
  if (run.phase === 'wait_preview') {
    if (run.prNumber == null) {
      run.phase = 'done'
      run.status = 'failed'
      run.errorDetail = 'Missing PR number'
      await save()
      return { run: toPublic(run), advanced: true, detail: 'missing pr' }
    }

    // Never keep a fixture/placeholder preview URL from a prior bad tick.
    if (isPlaceholderPreviewUrl(run.previewUrl)) {
      console.info('[fix-run] clearing placeholder preview_url', {
        runId: run.id,
        previewUrl: run.previewUrl,
      })
      run.previewUrl = null
    }

    // Already resolved (e.g. prior tick or concurrent discover) — do not
    // re-poll GitHub Deployments; that races with verify and clobbers items.
    if (run.previewUrl && !isPlaceholderPreviewUrl(run.previewUrl)) {
      run.phase = 'verify_preview_next'
      advanced = true
      detail = 'preview already resolved'
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    if (!run.prevContents[PREVIEW_WAIT_STARTED_KEY]) {
      run.prevContents = {
        ...run.prevContents,
        [PREVIEW_WAIT_STARTED_KEY]: now,
      }
      // Persist timer only — avoid full item rewrite on every pending poll.
      await save()
    }

    if (!ops.waitForPreview) {
      run.phase = 'done'
      run.status = 'failed'
      run.errorDetail =
        'Preview resolution is not configured — cannot verify without a real deployment URL'
      await save()
      return {
        run: toPublic(run),
        advanced: true,
        detail: 'preview resolver missing',
      }
    }

    const preview = await ops.waitForPreview({
      creds,
      prNumber: run.prNumber,
      branchName: run.branchName,
    })
    if (!preview.ok) {
      const started = previewWaitStartedAt(run) ?? Date.parse(now)
      const elapsed = Date.now() - started
      console.info('[fix-run] preview wait pending', {
        runId: run.id,
        prNumber: run.prNumber,
        branchName: run.branchName,
        error: preview.error,
        elapsedMs: elapsed,
      })
      // Auth-wall / non-pending hard failures fail the run immediately.
      if (preview.pending === false) {
        run.phase = 'done'
        run.status = 'failed'
        run.errorDetail = preview.error
        await save()
        return {
          run: toPublic(run),
          advanced: true,
          detail: 'preview wait failed',
        }
      }
      if (elapsed >= PREVIEW_WAIT_TIMEOUT_MS) {
        run.phase = 'done'
        run.status = 'failed'
        run.errorDetail = `No preview URL within 15 minutes — missing signal: ${preview.error}`
        await save()
        return {
          run: toPublic(run),
          advanced: true,
          detail: 'preview wait timed out',
        }
      }
      // Stay on wait_preview for next tick (resumable). Do NOT save here —
      // a full saveRun rewrites every item from stale memory and can clobber
      // preview_verified written by a concurrent verify tick.
      detail = `preview wait: ${preview.error}`
      return { run: toPublic(run), advanced: false, detail }
    }
    if (isPlaceholderPreviewUrl(preview.previewUrl)) {
      run.phase = 'done'
      run.status = 'failed'
      run.errorDetail =
        'Preview resolver returned a placeholder host — refusing to verify'
      await save()
      return {
        run: toPublic(run),
        advanced: true,
        detail: 'placeholder preview refused',
      }
    }
    run.previewUrl = preview.previewUrl
    run.phase = 'verify_preview_next'
    advanced = true
    detail = 'preview ready'
    await save()
    return { run: toPublic(run), advanced, detail }
  }

  // ── verify_preview_next ─────────────────────────────────────────
  if (run.phase === 'verify_preview_next') {
    // Resume path: placeholder stored by older builds → re-enter wait_preview.
    if (isPlaceholderPreviewUrl(run.previewUrl)) {
      console.info('[fix-run] placeholder preview on verify — back to wait', {
        runId: run.id,
        previewUrl: run.previewUrl,
      })
      run.previewUrl = null
      run.prevContents = {
        ...run.prevContents,
        [PREVIEW_WAIT_STARTED_KEY]: now,
      }
      run.phase = 'wait_preview'
      advanced = true
      detail = 'cleared placeholder preview; waiting for real deploy'
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    const next = itemsNeedingPreviewVerify(run.items)[0]
    if (!next) {
      run.phase = nextPhaseAfterPreviewVerify(run.items)
      advanced = true
      detail = 'preview verify queue empty'
      await save()
      return { run: toPublic(run), advanced, detail }
    }
    const finding = findings.get(next.findingId)
    if (!finding || !run.previewUrl) {
      const idx = run.items.findIndex((i) => i.id === next.id)
      run.items[idx] = markItemFailed(
        next,
        'Missing finding or preview URL',
        now,
      )
      await revertItemCommit(run, next.id, ops, creds)
      advanced = true
      detail = 'preview verify failed setup'
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    const url =
      resolveVerifyUrl(finding, run.previewUrl) ||
      previewPageUrl(run.previewUrl, finding.pageUrl)
    let body = ''
    let fetchOk = false
    let fetchStatus = 0
    if (next.path && input.deps.fetchPage) {
      const fetched = await input.deps.fetchPage(url)
      fetchStatus = fetched.status
      fetchOk = fetched.ok && fetched.status >= 200 && fetched.status < 400
      body = fetched.body
    }

    if (!fetchOk) {
      const idx = run.items.findIndex((i) => i.id === next.id)
      const failReason =
        fetchStatus === 401 || fetchStatus === 403
          ? 'Your preview is protected by a login; turn off Vercel Authentication for previews'
          : `Preview re-fetch failed for ${url}`
      run.items[idx] = markItemFailed(next, failReason, now)
      await revertItemCommit(run, next.id, ops, creds)
      console.info('[fix-run] preview verify failed', {
        runId: run.id,
        findingId: next.findingId,
        url,
      })
      advanced = true
      detail = `preview fetch failed ${next.findingId}`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    const verified = await verifyBodyForFinding(
      finding,
      body,
      url,
      'preview',
      input.deps.fetchPage
        ? (async (u: RequestInfo | URL) => {
            const r = await input.deps.fetchPage(String(u))
            return new Response(r.body, { status: r.status })
          }) as typeof fetch
        : undefined,
    )
    const idx = run.items.findIndex((i) => i.id === next.id)
    if (!verified.ok) {
      run.items[idx] = markItemFailed(next, verified.detail, now)
      await revertItemCommit(run, next.id, ops, creds)
      advanced = true
      detail = `preview verify failed ${next.findingId}`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    run.items[idx] = {
      ...next,
      status: 'preview_verified',
      previewVerifiedAt: now,
      failureReason: null,
      updatedAt: now,
    }
    console.info('[fix-run] preview verified', {
      runId: run.id,
      findingId: next.findingId,
      url,
    })
    advanced = true
    detail = `preview verified ${next.findingId}`
    await save()
    return { run: toPublic(run), advanced, detail }
  }

  // ── await_approval ──────────────────────────────────────────────
  if (run.phase === 'await_approval') {
    const auto = await resolveSiteAutoMergeEnabled({
      userId: input.userId,
      siteId: run.siteId,
      override: input.deps.autoMergeEnabledOverride,
    })

    let gatesPass = false
    let gateReason = ''
    if (auto.enabled) {
      // Existing gates: every remaining item auto-fixable + single-file blast
      // radius across the whole PR (multi-file fails → require human approve).
      const paths = [
        ...new Set(
          run.items
            .filter((i) => i.status === 'preview_verified' && i.path)
            .map((i) => i.path!),
        ),
      ]
      const blast = assessSingleFileBlastRadius(paths)
      const verdictOk = run.items
        .filter((i) => i.status === 'preview_verified')
        .every((i) => {
          const f = findings.get(i.findingId)
          if (!f) return false
          return evaluateAutoMergeVerdictGate(f).allowed
        })
      gatesPass = blast.ok && verdictOk
      gateReason = !blast.ok
        ? blast.reason
        : !verdictOk
          ? 'One or more items failed verdict auto-merge gate'
          : ''
      run.autoMergeAttempted = true
      run.autoMergeBlockedReason = gatesPass ? null : gateReason
    }

    const decision = canMergeRun({
      approvedAt: run.approvedAt,
      autoMergeEnabled: auto.enabled,
      autoMergeGatesPass: gatesPass,
      allPreviewVerified: allRemainingPreviewVerified(run.items),
    })

    if (decision.allowed) {
      run.phase = 'merge'
      run.status = 'merging'
      advanced = true
      detail = decision.reason
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    run.status = 'awaiting_approval'
    detail = decision.reason
    await save()
    return { run: toPublic(run), advanced: false, detail }
  }

  // ── merge ───────────────────────────────────────────────────────
  if (run.phase === 'merge') {
    if (run.prNumber == null) {
      run.phase = 'done'
      run.status = 'failed'
      run.errorDetail = 'Cannot merge without PR'
      await save()
      return { run: toPublic(run), advanced: true, detail: 'no pr' }
    }
    const allowed =
      !!run.approvedAt ||
      (run.autoMergeAttempted && !run.autoMergeBlockedReason)
    if (!allowed) {
      run.phase = 'await_approval'
      run.status = 'awaiting_approval'
      detail = 'merge blocked — approval required'
      await save()
      return { run: toPublic(run), advanced: true, detail }
    }

    const mergePrNumber = run.prNumber!
    let merged: Awaited<ReturnType<GithubOps['mergePullRequest']>>
    try {
      merged = await withFixRunMergeGate(() =>
        ops.mergePullRequest({
          creds,
          prNumber: mergePrNumber,
        }),
      )
    } catch (err) {
      const failMsg = isCustomerWriteGateError(err)
        ? customerWriteGateUserMessage(err)
        : err instanceof Error
          ? err.message
          : 'merge failed'
      run.errorDetail = failMsg
      run.phase = 'await_approval'
      run.status = 'awaiting_approval'
      detail = `merge failed: ${failMsg}`
      await save()
      return { run: toPublic(run), advanced: true, detail }
    }
    if (!merged.ok) {
      run.errorDetail = merged.error
      run.phase = 'await_approval'
      run.status = 'awaiting_approval'
      detail = `merge failed: ${merged.error}`
      await save()
      return { run: toPublic(run), advanced: true, detail }
    }
    run.mergeSha = merged.mergeSha
    run.phase = 'verify_production_next'
    advanced = true
    detail = `merged ${merged.mergeSha}`
    await save()
    return { run: toPublic(run), advanced, detail }
  }

  // ── verify_production_next ──────────────────────────────────────
  if (run.phase === 'verify_production_next') {
    const next = itemsNeedingProductionVerify(run.items)[0]
    if (!next) {
      run.phase = 'recrawl'
      advanced = true
      detail = 'production queue empty'
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    // Gate: do not verify any item until production deploy for mergeSha is READY.
    if (run.prevContents[PROD_DEPLOY_READY_KEY] !== '1') {
      if (!run.mergeSha) {
        run.phase = 'done'
        run.status = 'failed'
        run.errorDetail = 'Missing merge SHA — cannot wait for production deploy'
        await save()
        return { run: toPublic(run), advanced: true, detail: 'missing merge sha' }
      }
      if (!run.prevContents[PROD_DEPLOY_WAIT_STARTED_KEY]) {
        run.prevContents = {
          ...run.prevContents,
          [PROD_DEPLOY_WAIT_STARTED_KEY]: now,
        }
      }
      if (!ops.waitForProductionDeploy) {
        run.phase = 'done'
        run.status = 'failed'
        run.errorDetail =
          'Production deploy wait is not configured — refusing to verify against a possibly stale host'
        await save()
        return {
          run: toPublic(run),
          advanced: true,
          detail: 'production deploy wait missing',
        }
      }
      const prod = await ops.waitForProductionDeploy({
        creds,
        mergeSha: run.mergeSha,
      })
      const startedRaw = run.prevContents[PROD_DEPLOY_WAIT_STARTED_KEY]
      const startedMs = startedRaw ? Date.parse(startedRaw) : Date.parse(now)
      const elapsed = Date.now() - (Number.isFinite(startedMs) ? startedMs : Date.parse(now))
      if (!prod.ok) {
        console.info('[fix-run] production deploy wait pending', {
          runId: run.id,
          mergeSha: run.mergeSha,
          error: prod.error,
          elapsedMs: elapsed,
        })
        if (prod.pending === false) {
          run.phase = 'done'
          run.status = 'failed'
          run.errorDetail = prod.error
          await save()
          return {
            run: toPublic(run),
            advanced: true,
            detail: 'production deploy wait failed',
          }
        }
        if (elapsed >= PROD_DEPLOY_WAIT_TIMEOUT_MS) {
          run.phase = 'done'
          run.status = 'failed'
          run.errorDetail = `No production deployment READY for merge ${run.mergeSha.slice(0, 7)} within 15 minutes — missing signal: ${prod.error}`
          await save()
          return {
            run: toPublic(run),
            advanced: true,
            detail: 'production deploy wait timed out',
          }
        }
        await save()
        return {
          run: toPublic(run),
          advanced: false,
          detail: `production deploy wait: ${prod.error}`,
        }
      }
      run.prevContents = {
        ...run.prevContents,
        [PROD_DEPLOY_READY_KEY]: '1',
      }
      console.info('[fix-run] production deploy ready', {
        runId: run.id,
        mergeSha: run.mergeSha,
        detail: prod.detail,
      })
      await save()
      // Fall through and verify the first item in this same tick.
    }

    const finding = findings.get(next.findingId)
    if (!finding) {
      const idx = run.items.findIndex((i) => i.id === next.id)
      run.items[idx] = markItemFailed(next, 'Finding missing at prod verify', now)
      advanced = true
      await save()
      return { run: toPublic(run), advanced, detail: 'finding missing' }
    }

    const url =
      resolveVerifyUrl(finding, input.deps.siteOrigin) ||
      productionPageUrl(input.deps.siteOrigin, finding.pageUrl)
    const fetched = await input.deps.fetchPage(url)
    if (!fetched.ok) {
      const idx = run.items.findIndex((i) => i.id === next.id)
      run.items[idx] = markItemFailed(
        next,
        `Production re-fetch failed for ${url}`,
        now,
      )
      advanced = true
      detail = `prod fetch failed ${next.findingId}`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    const verified = await verifyBodyForFinding(
      finding,
      fetched.body,
      url,
      'production',
      (async (u: RequestInfo | URL) => {
        const r = await input.deps.fetchPage(String(u))
        return new Response(r.body, { status: r.status })
      }) as typeof fetch,
    )
    const idx = run.items.findIndex((i) => i.id === next.id)
    if (!verified.ok) {
      run.items[idx] = markItemFailed(next, verified.detail, now)
      advanced = true
      detail = `prod verify failed ${next.findingId}`
      await save()
      return { run: toPublic(run), advanced, detail }
    }

    run.items[idx] = {
      ...next,
      status: 'verified_live',
      productionVerifiedAt: now,
      failureReason: null,
      updatedAt: now,
    }

    await appendOutcomeRecordLocal({
      origin: input.deps.siteOrigin,
      topicId: finding.topicId,
      verdict: finding.verdict,
      pageUrl: finding.pageUrl || input.deps.siteOrigin,
      kind: finding.kind,
      detectedAt: finding.firstSeenAt || now,
      fixedAt: now,
      prUrl: run.prUrl || '',
      prNumber: run.prNumber || 0,
      mergeSha: run.mergeSha,
      autoMerged: !!run.autoMergeAttempted && !run.approvedAt,
      productionVerify: 'OK',
      productionVerifyDetail: verified.detail,
      productionVerifiedAt: now,
      outcome: 'closed',
    })

    await getFindingsStore().recordSeorankoFix({
      findingId: next.findingId,
      fixedAt: now,
      verificationAt: now,
      postFixStatus: 'verified',
    })

    console.info('[fix-run] production verified', {
      runId: run.id,
      findingId: next.findingId,
      url,
    })
    advanced = true
    detail = `prod verified ${next.findingId}`
    await save()
    return { run: toPublic(run), advanced, detail }
  }

  // ── recrawl ─────────────────────────────────────────────────────
  if (run.phase === 'recrawl') {
    if (input.deps.startRecrawl) {
      try {
        await input.deps.startRecrawl(run.siteId)
      } catch (e) {
        console.info('[fix-run] recrawl start failed', {
          runId: run.id,
          error: e instanceof Error ? e.message : String(e),
        })
      }
    }
    run.phase = 'done'
    run.status = 'complete'
    run.summary = computeSummary(run.items)
    advanced = true
    detail = 'recrawl kicked; done'
    await save()
    return { run: toPublic(run), advanced, detail }
  }

  return { run: toPublic(run), advanced: false, detail: 'unknown phase' }
}

async function revertItemCommit(
  run: FixRun,
  itemId: string,
  ops: GithubOps,
  creds: GithubPrCreds,
): Promise<void> {
  const item = run.items.find((i) => i.id === itemId)
  if (!item?.path || !item.commitSha || !run.branchName) return
  const previousContent = run.prevContents?.[itemId]
  if (!previousContent) {
    console.info('[fix-run] revert skipped — no previous content', {
      runId: run.id,
      findingId: item.findingId,
    })
    return
  }
  const revertPath = item.path
  const revertBranch = run.branchName
  let reverted: Awaited<ReturnType<GithubOps['revertFileCommit']>>
  try {
    reverted = await withFixRunPrGate(() =>
      ops.revertFileCommit({
        creds,
        path: revertPath,
        branchName: revertBranch,
        previousContent,
        message: `revert: undo failed fix for ${item.findingId.slice(0, 8)}`,
      }),
    )
  } catch (err) {
    console.info('[fix-run] reverted commit', {
      runId: run.id,
      findingId: item.findingId,
      ok: false,
      error: isCustomerWriteGateError(err)
        ? customerWriteGateUserMessage(err)
        : err instanceof Error
          ? err.message
          : 'revert failed',
    })
    return
  }
  console.info('[fix-run] reverted commit', {
    runId: run.id,
    findingId: item.findingId,
    ok: reverted.ok,
    error: reverted.ok ? undefined : reverted.error,
  })
}

export async function approveFixRun(input: {
  runId: string
  userId: string
}): Promise<FixRunPublicState> {
  const store = getFixRunStore()
  const run = await store.getRun(input.runId, input.userId)
  if (!run) throw new Error('Run not found')
  if (!allRemainingPreviewVerified(run.items)) {
    throw new Error('Cannot approve — not all remaining items are preview-verified')
  }
  if (run.phase !== 'await_approval' && run.status !== 'awaiting_approval') {
    throw new Error(`Cannot approve in phase ${run.phase}`)
  }
  run.approvedAt = new Date().toISOString()
  run.phase = 'merge'
  run.status = 'merging'
  const saved = await store.saveRun(run)
  return toPublic(saved)
}

export function defaultTickDeps(partial: Partial<TickDeps> & {
  creds: GithubPrCreds
  siteOrigin: string
}): TickDeps {
  return {
    ops: partial.ops || createLiveGithubOps(),
    creds: partial.creds,
    siteOrigin: partial.siteOrigin,
    fetchPage:
      partial.fetchPage ||
      (async (url) => {
        const res = await fetch(url, {
          signal: AbortSignal.timeout(20000),
          headers: { 'User-Agent': 'SEORANKO-FixRun/1.0' },
        })
        const body = await res.text()
        return { ok: res.ok, body, status: res.status }
      }),
    autoMergeEnabledOverride: partial.autoMergeEnabledOverride ?? null,
    deadlineMs: partial.deadlineMs,
    startRecrawl: partial.startRecrawl,
    now: partial.now,
  }
}
