/**
 * Durable Fix Agent fixture e2e — advances one/more steps per invocation.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  E2E_FIXTURE_ORIGIN,
  E2E_FIXTURE_OWNER,
  E2E_FIXTURE_REPO,
  E2E_FIXTURE_SITE_ID,
  E2E_STEP_ORDER,
  E2E_STEP_TIMEOUT_MS,
  E2E_TICK_BUDGET_MS,
  type E2eStepName,
} from './constants'
import {
  compareFindingsExact,
  loadExpectedAutoFixable,
  loadExpectedFindings,
} from './compare'
import { notifyE2eFailure } from './notify'
import { resetFixtureMainToSeed } from './reset-seed'
import {
  consecutivePassingE2eDays,
  createE2eRun,
  getActiveE2eRun,
  getE2eRun,
  updateE2eRun,
  type E2eRunRow,
  type E2eStepRecord,
} from './store'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'
import { checkProductionDeployOnce } from '@/lib/fix-strategies/findings-ui/fix-flow/wait-vercel-deploy'
import { startCrawlRun } from '@/lib/fix-strategies/findings-ui/crawl/orchestrator'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl/store'
import { drainCrawlRunToTerminal } from '@/lib/fix-strategies/findings-ui/crawl/scheduled-recrawl'
import {
  startFixRun,
  tickFixRun,
  approveFixRun,
  defaultTickDeps,
  createLiveGithubOps,
  getFixRunStore,
} from '@/lib/fix-strategies/findings-ui/fix-run'
import { createClient } from '@supabase/supabase-js'

export type E2eTickResult = {
  run: E2eRunRow
  advanced: boolean
  done: boolean
  detail: string
}

function initialSteps(): E2eStepRecord[] {
  return E2E_STEP_ORDER.map((name) => ({ name, status: 'pending' as const }))
}

function masterUserId(): Promise<string> {
  const email = process.env.MASTER_EMAIL?.trim()
  if (!email) throw new Error('MASTER_EMAIL not configured')
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY!
  const sb = createClient(url, key)
  return sb.auth.admin
    .listUsers({ perPage: 200 })
    .then(({ data, error }) => {
      if (error) throw error
      const u = data.users.find(
        (x) => x.email?.toLowerCase() === email.toLowerCase(),
      )
      if (!u) throw new Error(`Master user ${email} not found`)
      return u.id
    })
}

async function fixtureCreds(userId: string) {
  const app = await resolveGithubAppRepoCreds({
    owner: E2E_FIXTURE_OWNER,
    repo: E2E_FIXTURE_REPO,
    userId,
  })
  if (!app?.accessToken) {
    throw new Error('GitHub App credentials unavailable for seoranko-fixture')
  }
  return {
    owner: app.owner,
    repo: app.repo,
    baseBranch: app.baseBranch || 'main',
    accessToken: app.accessToken,
  }
}

function markStep(
  steps: E2eStepRecord[],
  name: E2eStepName,
  patch: Partial<E2eStepRecord>,
): E2eStepRecord[] {
  return steps.map((s) => (s.name === name ? { ...s, ...patch } : s))
}

async function failRun(
  run: E2eRunRow,
  step: E2eStepName,
  reason: string,
): Promise<E2eRunRow> {
  const steps = markStep(run.steps, step, {
    status: 'failed',
    finishedAt: new Date().toISOString(),
    error: reason,
  })
  const updated = await updateE2eRun(run.id, {
    status: 'failed',
    current_step: step,
    steps,
    first_failing_step: step,
    fail_reason: reason,
    finished_at: new Date().toISOString(),
  })
  await notifyE2eFailure({
    runId: run.id,
    failingStep: step,
    reason,
  })
  return updated
}

function stepTimedOut(step: E2eStepRecord, name: E2eStepName): boolean {
  if (!step.startedAt) return false
  const elapsed = Date.now() - Date.parse(step.startedAt)
  return elapsed >= E2E_STEP_TIMEOUT_MS[name]
}

/** Start a new e2e run (or return the active one). */
export async function startOrGetE2eRun(): Promise<E2eRunRow> {
  const active = await getActiveE2eRun()
  if (active) return active
  return createE2eRun({
    siteId: E2E_FIXTURE_SITE_ID,
    steps: initialSteps(),
  })
}

/**
 * Advance the e2e run until soft deadline or terminal status.
 */
export async function tickE2eRun(input?: {
  runId?: string
  deadlineMs?: number
}): Promise<E2eTickResult> {
  const deadline = Date.now() + (input?.deadlineMs ?? E2E_TICK_BUDGET_MS)
  let run = input?.runId
    ? await getE2eRun(input.runId)
    : await startOrGetE2eRun()
  if (!run) throw new Error('e2e run not found')
  if (run.status !== 'running') {
    return { run, advanced: false, done: true, detail: `already ${run.status}` }
  }

  const userId = await masterUserId()
  let advanced = false
  let detail = 'idle'

  while (Date.now() < deadline && run.status === 'running') {
    const stepName = (run.current_step || E2E_STEP_ORDER[0]) as E2eStepName
    let steps = run.steps
    let step = steps.find((s) => s.name === stepName)
    if (!step) {
      run = await failRun(run, 'finalize', `Unknown step ${stepName}`)
      return { run, advanced: true, done: true, detail: 'unknown step' }
    }
    if (step.status === 'pending') {
      steps = markStep(steps, stepName, {
        status: 'running',
        startedAt: new Date().toISOString(),
      })
      run = await updateE2eRun(run.id, { steps, current_step: stepName })
      step = run.steps.find((s) => s.name === stepName)!
      advanced = true
    }
    if (stepTimedOut(step, stepName)) {
      run = await failRun(
        run,
        stepName,
        `Step ${stepName} exceeded ${E2E_STEP_TIMEOUT_MS[stepName] / 1000}s`,
      )
      return { run, advanced: true, done: true, detail: 'step timeout' }
    }

    const result = await executeStep(stepName, run, userId, deadline)
    run = result.run
    detail = result.detail
    advanced = advanced || result.advanced
    if (result.done || run.status !== 'running') break
    if (!result.advanced) break // pending external wait — continue next tick
    // Fix-run phases do one micro-step per invocation so continues never overlap.
    if (
      stepName === 'fix_run_preview' ||
      stepName === 'approve_merge_verify'
    ) {
      break
    }
  }

  return {
    run,
    advanced,
    done: run.status !== 'running',
    detail,
  }
}

async function executeStep(
  step: E2eStepName,
  run: E2eRunRow,
  userId: string,
  deadline: number,
): Promise<{ run: E2eRunRow; advanced: boolean; done: boolean; detail: string }> {
  switch (step) {
    case 'reset_seed':
      return stepResetSeed(run, userId)
    case 'wait_seed_production':
      return stepWaitSeedProduction(run, userId)
    case 'crawl_compare':
      return stepCrawlCompare(run, userId, deadline)
    case 'fix_run_preview':
      return stepFixRunPreview(run, userId, deadline)
    case 'approve_merge_verify':
      return stepApproveMergeVerify(run, userId, deadline)
    case 'recrawl_assert_closed':
      return stepRecrawlAssert(run, userId, deadline)
    case 'finalize':
      return stepFinalize(run)
    default:
      return {
        run: await failRun(run, 'finalize', `Unhandled step ${step}`),
        advanced: true,
        done: true,
        detail: 'unhandled',
      }
  }
}

async function advanceTo(
  run: E2eRunRow,
  from: E2eStepName,
  to: E2eStepName,
  detail: string,
  extra?: Parameters<typeof updateE2eRun>[1],
): Promise<E2eRunRow> {
  let steps = markStep(run.steps, from, {
    status: 'passed',
    finishedAt: new Date().toISOString(),
    detail,
  })
  steps = markStep(steps, to, {
    status: 'pending',
  })
  return updateE2eRun(run.id, {
    current_step: to,
    steps,
    ...extra,
  })
}

async function stepResetSeed(run: E2eRunRow, userId: string) {
  // Idempotent: concurrent ticks must not create repeated reset commits.
  const prior = run.steps.find((s) => s.name === 'reset_seed')
  if (run.seed_sha && (prior?.status === 'passed' || prior?.status === 'running')) {
    const next = await advanceTo(
      run,
      'reset_seed',
      'wait_seed_production',
      prior.detail || `reuse seed_sha ${run.seed_sha.slice(0, 7)}`,
      { seed_sha: run.seed_sha },
    )
    return {
      run: next,
      advanced: true,
      done: false,
      detail: 'skipped duplicate reset',
    }
  }

  const creds = await fixtureCreds(userId)
  const reset = await resetFixtureMainToSeed({ accessToken: creds.accessToken })
  if (!reset.ok) {
    return {
      run: await failRun(run, 'reset_seed', reset.error),
      advanced: true,
      done: true,
      detail: reset.error,
    }
  }
  const next = await advanceTo(run, 'reset_seed', 'wait_seed_production', reset.detail, {
    seed_sha: reset.mainSha,
  })
  return { run: next, advanced: true, done: false, detail: reset.detail }
}

/** Seed tree fingerprint on the live production origin (same tree as seed tip). */
async function fixtureOriginLooksLikeSeed(): Promise<boolean> {
  try {
    const res = await fetch(`${E2E_FIXTURE_ORIGIN}/robots.txt`, {
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': 'SEORANKO-E2E/1.0' },
      cache: 'no-store',
    })
    if (!res.ok) return false
    const body = await res.text()
    return /Crawl-delay:\s*10/i.test(body)
  } catch {
    return false
  }
}

async function stepWaitSeedProduction(run: E2eRunRow, userId: string) {
  const sha = run.seed_sha
  if (!sha) {
    return {
      run: await failRun(run, 'wait_seed_production', 'Missing seed_sha'),
      advanced: true,
      done: true,
      detail: 'missing sha',
    }
  }
  const creds = await fixtureCreds(userId)
  const once = await checkProductionDeployOnce({
    owner: creds.owner,
    repo: creds.repo,
    mergeSha: sha,
    accessToken: creds.accessToken,
  })
  if (once.ok) {
    const next = await advanceTo(
      run,
      'wait_seed_production',
      'crawl_compare',
      once.detail,
    )
    return { run: next, advanced: true, done: false, detail: once.detail }
  }
  if (once.pending === false) {
    return {
      run: await failRun(run, 'wait_seed_production', once.error),
      advanced: true,
      done: true,
      detail: once.error,
    }
  }

  // Private fixture often has Deployments 403 / no commit statuses. After the
  // reset commit (seed tree), accept production when the live origin serves
  // the seed fingerprint and the wait step has been running ≥45s.
  const waitStep = run.steps.find((s) => s.name === 'wait_seed_production')
  const startedMs = waitStep?.startedAt ? Date.parse(waitStep.startedAt) : 0
  const waitedMs = startedMs ? Date.now() - startedMs : 0
  if (waitedMs >= 45_000 && (await fixtureOriginLooksLikeSeed())) {
    const detail = `seed fingerprint live on ${E2E_FIXTURE_ORIGIN} after ${Math.round(waitedMs / 1000)}s (GitHub deploy signals unavailable: ${once.error})`
    const next = await advanceTo(
      run,
      'wait_seed_production',
      'crawl_compare',
      detail,
    )
    return { run: next, advanced: true, done: false, detail }
  }

  return {
    run,
    advanced: false,
    done: false,
    detail: once.error,
  }
}

async function stepCrawlCompare(
  run: E2eRunRow,
  userId: string,
  deadline: number,
) {
  const store = getFindingsStore()
  let crawlId = run.crawl_run_id
  if (!crawlId) {
    const started = await startCrawlRun({
      siteId: E2E_FIXTURE_SITE_ID,
      userId,
      origin: E2E_FIXTURE_ORIGIN,
    })
    crawlId = started.runId
    run = await updateE2eRun(run.id, { crawl_run_id: crawlId })
  }

  const remaining = Math.max(5_000, deadline - Date.now() - 2_000)
  // Drain with budget — may need multiple e2e ticks
  const drained = await drainCrawlRunToTerminal(crawlId, store, {
    maxTicks: Math.min(80, Math.floor(remaining / 1500)),
  })
  if (!drained.done) {
    return {
      run,
      advanced: false,
      done: false,
      detail: `crawl still ${drained.status}`,
    }
  }
  if (drained.status === 'failed') {
    return {
      run: await failRun(run, 'crawl_compare', 'Crawl failed'),
      advanced: true,
      done: true,
      detail: 'crawl failed',
    }
  }

  const findings = await store.listFindings({
    siteId: E2E_FIXTURE_SITE_ID,
    includeInformational: true,
  })
  const observed = findings.map((f) => ({
    topicId: f.topicId,
    verdict: f.verdict,
    pageUrl: f.pageUrl,
    surfaceClass: f.surfaceClass,
    autoFixable: f.autoFixable && f.surfaceClass === 'auto-fixable',
  }))
  const cmp = compareFindingsExact(observed, loadExpectedFindings())
  if (!cmp.ok) {
    return {
      run: await failRun(run, 'crawl_compare', cmp.reason),
      advanced: true,
      done: true,
      detail: cmp.reason,
    }
  }
  const next = await advanceTo(
    run,
    'crawl_compare',
    'fix_run_preview',
    `crawl ${drained.status}; findings match expected.json (${observed.length})`,
  )
  return { run: next, advanced: true, done: false, detail: 'findings match' }
}

async function abandonStaleFixtureFixRuns(userId: string, keepId?: string | null) {
  const store = getFixRunStore()
  // Drain any active runs for the fixture site so e2e always starts clean.
  for (let i = 0; i < 5; i++) {
    const active = await store.listActiveForSite(E2E_FIXTURE_SITE_ID, userId)
    if (!active) break
    if (keepId && active.id === keepId) break
    active.phase = 'done'
    active.status = 'failed'
    active.errorDetail =
      active.errorDetail ||
      'Abandoned by Fix Agent e2e so a fresh seed run can start'
    await store.saveRun(active)
  }
}

/**
 * Prior e2e/fix runs can leave auto-fixables as post_fix_status=verified even
 * after seed reset if the crawl did not flip them to regressed. Clear verified
 * on the fixture site only so startFixRun selects the full expected auto set.
 */
async function clearFixtureStaleVerified(): Promise<number> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) return 0
  const sb = createClient(url, key)
  const { data, error } = await sb
    .from('fix_strategies_findings')
    .update({ post_fix_status: null, updated_at: new Date().toISOString() })
    .eq('site_id', E2E_FIXTURE_SITE_ID)
    .eq('surface_class', 'auto-fixable')
    .eq('post_fix_status', 'verified')
    .select('id')
  if (error) {
    console.info('[e2e] clearFixtureStaleVerified', error.message)
    return 0
  }
  return data?.length ?? 0
}

async function stepFixRunPreview(
  run: E2eRunRow,
  userId: string,
  deadline: number,
) {
  const creds = await fixtureCreds(userId)
  const ops = createLiveGithubOps()
  let fixRunId = run.fix_run_id
  if (!fixRunId) {
    await abandonStaleFixtureFixRuns(userId, null)
    const cleared = await clearFixtureStaleVerified()
    if (cleared > 0) {
      console.info('[e2e] cleared stale verified autos', { cleared })
    }
    const started = await startFixRun({
      userId,
      siteId: E2E_FIXTURE_SITE_ID,
      siteDomain: 'seoranko-fixture.vercel.app',
      githubConnected: true,
      creds,
      ops,
    })
    if (!started.ok) {
      return {
        run: await failRun(run, 'fix_run_preview', started.error),
        advanced: true,
        done: true,
        detail: started.error,
      }
    }
    fixRunId = started.run.id
    run = await updateE2eRun(run.id, { fix_run_id: fixRunId })
  }

  const expectedAuto = loadExpectedAutoFixable()
  // Exactly one fix-run micro-tick per e2e invocation — overlapping continues
  // must not thrash wait_preview/verify against each other.
  if (Date.now() >= deadline - 3_000) {
    return { run, advanced: false, done: false, detail: 'deadline' }
  }
  const tick = await tickFixRun({
    runId: fixRunId!,
    userId,
    deps: defaultTickDeps({
      ops,
      creds,
      siteOrigin: E2E_FIXTURE_ORIGIN,
      autoMergeEnabledOverride: false,
    }),
  })
  const fr = tick.run
  if (fr.status === 'failed' || fr.phase === 'done') {
    return {
      run: await failRun(
        run,
        'fix_run_preview',
        fr.errorDetail || `fix run ended in ${fr.phase}/${fr.status}`,
      ),
      advanced: true,
      done: true,
      detail: 'fix run failed early',
    }
  }
  if (fr.phase === 'await_approval' || fr.status === 'awaiting_approval') {
    const previewed = fr.items.filter((i) => i.status === 'preview_verified')
    const failed = fr.items.filter((i) => i.status === 'failed')
    if (failed.length > 0) {
      return {
        run: await failRun(
          run,
          'fix_run_preview',
          `Items failed before approval: ${failed.map((f) => f.failureReason).join('; ')}`,
        ),
        advanced: true,
        done: true,
        detail: 'item failed',
      }
    }
    if (previewed.length !== expectedAuto.length) {
      return {
        run: await failRun(
          run,
          'fix_run_preview',
          `Expected ${expectedAuto.length} preview-verified items, got ${previewed.length}`,
        ),
        advanced: true,
        done: true,
        detail: 'count mismatch',
      }
    }
    if (fr.prNumber == null) {
      return {
        run: await failRun(run, 'fix_run_preview', 'Missing PR number'),
        advanced: true,
        done: true,
        detail: 'no pr',
      }
    }
    const next = await advanceTo(
      run,
      'fix_run_preview',
      'approve_merge_verify',
      `PR #${fr.prNumber}; ${previewed.length} preview-verified`,
    )
    return { run: next, advanced: true, done: false, detail: 'awaiting approval' }
  }
  return {
    run,
    advanced: tick.advanced,
    done: false,
    detail: tick.detail || 'fix run still progressing',
  }
}

async function stepApproveMergeVerify(
  run: E2eRunRow,
  userId: string,
  deadline: number,
) {
  if (!run.fix_run_id) {
    return {
      run: await failRun(run, 'approve_merge_verify', 'Missing fix_run_id'),
      advanced: true,
      done: true,
      detail: 'missing fix run',
    }
  }
  // Only this fixture site id may auto-approve via e2e.
  if (run.site_id !== E2E_FIXTURE_SITE_ID) {
    return {
      run: await failRun(
        run,
        'approve_merge_verify',
        'E2E approve/merge is allowed only for the fixture site id',
      ),
      advanced: true,
      done: true,
      detail: 'site guard',
    }
  }

  const creds = await fixtureCreds(userId)
  const ops = createLiveGithubOps()
  const store = getFixRunStore()
  let fr = await store.getRun(run.fix_run_id, userId)
  if (!fr) {
    return {
      run: await failRun(run, 'approve_merge_verify', 'Fix run not found'),
      advanced: true,
      done: true,
      detail: 'missing',
    }
  }

  if (fr.phase === 'await_approval' && !fr.approvedAt) {
    await approveFixRun({ runId: fr.id, userId })
  }

  if (Date.now() >= deadline - 3_000) {
    return { run, advanced: false, done: false, detail: 'deadline' }
  }
  const tick = await tickFixRun({
    runId: fr.id,
    userId,
    deps: defaultTickDeps({
      ops,
      creds,
      siteOrigin: E2E_FIXTURE_ORIGIN,
      autoMergeEnabledOverride: false,
      startRecrawl: async (siteId) => {
        const started = await startCrawlRun({
          siteId,
          userId,
          origin: E2E_FIXTURE_ORIGIN,
        })
        await drainCrawlRunToTerminal(started.runId, getFindingsStore())
      },
    }),
  })
  fr = (await store.getRun(fr.id, userId))!
  if (tick.run.mergeSha && !run.merge_sha) {
    run = await updateE2eRun(run.id, { merge_sha: tick.run.mergeSha })
  }
  if (fr.status === 'complete' || fr.phase === 'done') {
    const live = fr.items.filter((i) => i.status === 'verified_live')
    const expectedN = loadExpectedAutoFixable().length
    if (live.length < expectedN) {
      const failed = fr.items.filter((i) => i.status === 'failed')
      return {
        run: await failRun(
          run,
          'approve_merge_verify',
          `Only ${live.length}/${expectedN} verified live. Failed: ${failed.map((f) => f.failureReason).join('; ')}`,
        ),
        advanced: true,
        done: true,
        detail: 'verify incomplete',
      }
    }
    const next = await advanceTo(
      run,
      'approve_merge_verify',
      'recrawl_assert_closed',
      `merge ${fr.mergeSha}; ${live.length} verified live`,
      { merge_sha: fr.mergeSha },
    )
    return { run: next, advanced: true, done: false, detail: 'verified live' }
  }
  if (fr.status === 'failed') {
    return {
      run: await failRun(
        run,
        'approve_merge_verify',
        fr.errorDetail || 'fix run failed',
      ),
      advanced: true,
      done: true,
      detail: 'failed',
    }
  }
  return {
    run,
    advanced: tick.advanced,
    done: false,
    detail: tick.detail || 'merge/verify still progressing',
  }
}

async function stepRecrawlAssert(
  run: E2eRunRow,
  userId: string,
  deadline: number,
) {
  const store = getFindingsStore()
  // Persist recrawl id on the step detail so ticks resume the same crawl.
  let step = run.steps.find((s) => s.name === 'recrawl_assert_closed')
  let recrawlId =
    step?.detail?.startsWith('crawl:') ? step.detail.slice('crawl:'.length) : null
  if (!recrawlId) {
    const started = await startCrawlRun({
      siteId: E2E_FIXTURE_SITE_ID,
      userId,
      origin: E2E_FIXTURE_ORIGIN,
    })
    recrawlId = started.runId
    const steps = markStep(run.steps, 'recrawl_assert_closed', {
      status: 'running',
      detail: `crawl:${recrawlId}`,
    })
    run = await updateE2eRun(run.id, { steps })
    step = run.steps.find((s) => s.name === 'recrawl_assert_closed')
  }
  const remaining = Math.max(5_000, deadline - Date.now() - 2_000)
  const drained = await drainCrawlRunToTerminal(recrawlId, store, {
    maxTicks: Math.min(80, Math.floor(remaining / 1500)),
  })
  if (!drained.done) {
    return {
      run,
      advanced: false,
      done: false,
      detail: `post-fix crawl ${drained.status}`,
    }
  }

  const findings = await store.listFindings({
    siteId: E2E_FIXTURE_SITE_ID,
    includeInformational: false,
  })
  const expectedAuto = loadExpectedAutoFixable()
  const stillOpen = findings.filter(
    (f) =>
      expectedAuto.some(
        (e) =>
          e.topicId === f.topicId &&
          e.verdict === f.verdict &&
          (e.pageUrl || '') === (f.pageUrl || ''),
      ) &&
      f.postFixStatus !== 'verified' &&
      f.surfaceClass === 'auto-fixable',
  )
  if (stillOpen.length > 0) {
    return {
      run: await failRun(
        run,
        'recrawl_assert_closed',
        `Fixed findings still open: ${stillOpen.map((f) => `${f.topicId}/${f.verdict}`).join(', ')}`,
      ),
      advanced: true,
      done: true,
      detail: 'not closed',
    }
  }

  // No brand-new actionable auto-fixable beyond expected (none should remain).
  const newAuto = findings.filter(
    (f) =>
      f.surfaceClass === 'auto-fixable' &&
      f.postFixStatus !== 'verified' &&
      !expectedAuto.some(
        (e) => e.topicId === f.topicId && e.verdict === f.verdict,
      ),
  )
  if (newAuto.length > 0) {
    return {
      run: await failRun(
        run,
        'recrawl_assert_closed',
        `New actionable findings appeared: ${newAuto.map((f) => `${f.topicId}/${f.verdict}`).join(', ')}`,
      ),
      advanced: true,
      done: true,
      detail: 'new findings',
    }
  }

  const next = await advanceTo(
    run,
    'recrawl_assert_closed',
    'finalize',
    'post-fix crawl closed expected autos; no new autos',
  )
  return { run: next, advanced: true, done: false, detail: 'closed' }
}

async function stepFinalize(run: E2eRunRow) {
  const days = (await consecutivePassingE2eDays()) + 1
  const steps = markStep(run.steps, 'finalize', {
    status: 'passed',
    startedAt: new Date().toISOString(),
    finishedAt: new Date().toISOString(),
    detail: `passed; consecutive days ≈ ${days}`,
  })
  const updated = await updateE2eRun(run.id, {
    status: 'passed',
    current_step: 'finalize',
    steps,
    consecutive_pass_days: days,
    finished_at: new Date().toISOString(),
  })
  return {
    run: updated,
    advanced: true,
    done: true,
    detail: 'passed',
  }
}

/** Ensure expected.json is loadable (build-time sanity). */
export function assertExpectedFixturePresent(): void {
  const p = join(process.cwd(), 'fixtures/seoranko-fixture-site/expected.json')
  const raw = readFileSync(p, 'utf8')
  const parsed = JSON.parse(raw) as { findings?: unknown[] }
  if (!Array.isArray(parsed.findings) || parsed.findings.length < 5) {
    throw new Error('expected.json missing or too small')
  }
}
