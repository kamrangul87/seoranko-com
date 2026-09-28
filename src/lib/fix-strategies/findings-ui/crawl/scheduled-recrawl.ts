/**
 * Change Monitoring 3.3 — weekly scheduled recrawl per connected site.
 *
 * - Once per UTC week (Monday 00:00 → next Monday).
 * - Uses Postgres-backed daily crawl-start quota (P2) — never bypasses it.
 * - Applies plan page limit; capped runs are partial with plan_page_limit named.
 * - Selective render stays in the crawl orchestrator (no render of pages that
 *   do not need it).
 * - Skip when last two *scheduled* crawls failed; report why.
 * - Drain ticks until complete/partial with finished_at — never leave running.
 * - Resolution only for URLs assessed in that run (orchestrator contract).
 */

import {
  crawlDailyLimitForUser,
  crawlPageQuotaForUser,
} from '@/lib/stripe/entitlements'
import type { CrawlRunRecord } from './constants'
import {
  failAbandonedCrawlRuns,
  processCrawlTick,
  startCrawlRun,
} from './orchestrator'
import {
  releaseCrawlStart,
  reserveCrawlStart,
} from './rate-limit'
import {
  getFindingsStore,
  type FindingsStore,
} from './store'
import {
  buildWhatChangedDigest,
  pickPreviousTerminalRunId,
  type WhatChangedDigest,
} from './what-changed'

/** UTC Monday 00:00:00.000 of the week containing `now`. */
export function utcWeekStartMs(nowMs: number = Date.now()): number {
  const d = new Date(nowMs)
  const day = d.getUTCDay() // 0=Sun … 1=Mon
  const daysFromMonday = (day + 6) % 7
  return Date.UTC(
    d.getUTCFullYear(),
    d.getUTCMonth(),
    d.getUTCDate() - daysFromMonday,
    0,
    0,
    0,
    0,
  )
}

export type ScheduledSkipReason =
  | 'already_ran_this_week'
  | 'in_progress_this_week'
  | 'two_consecutive_scheduled_failures'
  | 'crawl_quota'
  | 'no_origin'

export type ScheduledSiteDecision =
  | { action: 'run' }
  | { action: 'skip'; reason: ScheduledSkipReason; detail: string }

/**
 * Pure decision: whether this site should get a new scheduled crawl now.
 * `scheduledRuns` must be newest-first (as listRunsForSite returns).
 */
export function decideScheduledRecrawl(
  scheduledRuns: CrawlRunRecord[],
  nowMs: number = Date.now(),
): ScheduledSiteDecision {
  const weekStart = utcWeekStartMs(nowMs)
  const thisWeek = scheduledRuns.filter(
    (r) => Date.parse(r.createdAt) >= weekStart,
  )

  const inProgress = thisWeek.find(
    (r) => r.status === 'queued' || r.status === 'running',
  )
  if (inProgress) {
    return {
      action: 'skip',
      reason: 'in_progress_this_week',
      detail: `Scheduled run ${inProgress.id} is still ${inProgress.status} this UTC week — continue that run instead of starting another.`,
    }
  }

  const finishedThisWeek = thisWeek.find(
    (r) =>
      r.status === 'complete' ||
      r.status === 'partial' ||
      r.status === 'failed',
  )
  if (finishedThisWeek) {
    return {
      action: 'skip',
      reason: 'already_ran_this_week',
      detail: `Already had a scheduled crawl this UTC week (run ${finishedThisWeek.id}, status=${finishedThisWeek.status}).`,
    }
  }

  const lastTwo = scheduledRuns.slice(0, 2)
  if (
    lastTwo.length >= 2 &&
    lastTwo.every((r) => r.status === 'failed')
  ) {
    const reasons = lastTwo
      .map((r) => r.errorDetail || r.status)
      .join('; ')
    return {
      action: 'skip',
      reason: 'two_consecutive_scheduled_failures',
      detail: `Last two scheduled crawls failed — skipping rather than retrying indefinitely (${reasons}).`,
    }
  }

  return { action: 'run' }
}

export type ScheduledRecrawlSiteResult = {
  siteId: string | null
  userId: string
  origin: string
  decision: ScheduledSiteDecision
  /** True when we drained an already-open scheduled run rather than starting fresh. */
  resumed?: boolean
  runId?: string
  status?: string
  finishedAt?: string | null
  urlsFound?: number
  urlsDiscovered?: number
  urlsCrawled?: number
  pagesRendered?: number
  pagesRenderFailed?: number
  urlCap?: number | null
  isPartial?: boolean
  coverageNotes?: CrawlRunRecord['coverageNotes']
  /** Findings with status=resolved whose lastSeenRunId is not this run (absent + assessed). */
  resolvedCount?: number
  /** Findings with status=regressed last seen on this run. */
  regressedCount?: number
  /** CM 3.4 — delta vs previous terminal crawl. */
  whatChanged?: WhatChangedDigest | null
  error?: string
}

export type ScheduledSiteInput = {
  siteId: string | null
  userId: string
  origin: string
  /** User email for entitlement lookup (optional). */
  email?: string | null
  detectOnly?: boolean
}

const DRAIN_GUARD = 500

/**
 * Tick a run until terminal (complete/partial/failed) or guard exhausted.
 * Abandon-fail any leftover running state so we never leave finished_at null.
 */
export async function drainCrawlRunToTerminal(
  runId: string,
  store: FindingsStore,
  opts?: { maxTicks?: number },
): Promise<{
  status: string
  done: boolean
  finishedAt: string | null
  isPartial: boolean
}> {
  const maxTicks = opts?.maxTicks ?? DRAIN_GUARD
  let guard = 0
  let lastStatus = 'running'
  let isPartial = false
  while (guard++ < maxTicks) {
    const tick = await processCrawlTick(runId, { store })
    lastStatus = tick.status
    isPartial = tick.isPartial
    if (tick.done) break
  }
  let run = await store.getRun(runId)
  if (run && (run.status === 'queued' || run.status === 'running')) {
    // Must not leave scheduled runs stuck — force failed with finished_at.
    await store.updateRun(runId, {
      status: 'failed',
      finishedAt: new Date().toISOString(),
      errorDetail:
        'Scheduled drain exceeded tick budget before frontier emptied — marked failed so resolution/monitoring stay honest.',
    })
    run = await store.getRun(runId)
  }
  return {
    status: run?.status ?? lastStatus,
    done: Boolean(
      run &&
        (run.status === 'complete' ||
          run.status === 'partial' ||
          run.status === 'failed'),
    ),
    finishedAt: run?.finishedAt ?? null,
    isPartial: run?.isPartial ?? isPartial,
  }
}

async function countResolvedAndRegressed(
  store: FindingsStore,
  scope: { siteId: string | null; detectOrigin: string | null; userId: string },
  runId: string,
  runFinishedAt: string | null,
): Promise<{ resolvedCount: number; regressedCount: number }> {
  const findings = await store.listFindings({
    siteId: scope.siteId,
    detectOrigin: scope.detectOrigin ?? undefined,
    userId: scope.userId,
    includeInformational: true,
  })
  const finishedMs = runFinishedAt ? Date.parse(runFinishedAt) : NaN
  const resolvedCount = findings.filter((f) => {
    if (f.status !== 'resolved' || f.lastSeenRunId === runId || !f.resolvedAt) {
      return false
    }
    if (Number.isNaN(finishedMs)) return true
    // Newly resolved around this run's finish window (2 min slack for clock skew).
    return Math.abs(Date.parse(f.resolvedAt) - finishedMs) < 120_000
  }).length
  const regressedCount = findings.filter(
    (f) => f.status === 'regressed' && f.lastSeenRunId === runId,
  ).length
  return { resolvedCount, regressedCount }
}

/**
 * Run (or skip) one site's weekly scheduled recrawl.
 */
export async function runScheduledRecrawlForSite(
  site: ScheduledSiteInput,
  opts?: {
    store?: FindingsStore
    nowMs?: number
    /** Injected for tests — default uses real Postgres quota RPC. */
    reserve?: typeof reserveCrawlStart
    release?: typeof releaseCrawlStart
    dailyLimit?: number
    maxPages?: number
    planLabel?: string
    /** When true, resume an in-progress scheduled run this week instead of skipping. */
    resumeInProgress?: boolean
  },
): Promise<ScheduledRecrawlSiteResult> {
  const store = opts?.store ?? getFindingsStore()
  const nowMs = opts?.nowMs ?? Date.now()
  const origin = site.origin.replace(/\/$/, '')
  if (!origin) {
    return {
      siteId: site.siteId,
      userId: site.userId,
      origin,
      decision: {
        action: 'skip',
        reason: 'no_origin',
        detail: 'Site has no crawlable origin.',
      },
    }
  }

  const prior = site.siteId
    ? await store.listRunsForSite(site.siteId)
    : await store.listRunsForDetectOrigin(site.userId, origin)
  await failAbandonedCrawlRuns(store, prior)

  const scheduled = (await (site.siteId
    ? store.listRunsForSite(site.siteId)
    : store.listRunsForDetectOrigin(site.userId, origin)
  )).filter((r) => r.trigger === 'scheduled')

  const decision = decideScheduledRecrawl(scheduled, nowMs)

  // Resume path: drain an in-progress scheduled run rather than starting another.
  if (
    decision.action === 'skip' &&
    decision.reason === 'in_progress_this_week' &&
    opts?.resumeInProgress
  ) {
    const weekStart = utcWeekStartMs(nowMs)
    const active = scheduled.find(
      (r) =>
        Date.parse(r.createdAt) >= weekStart &&
        (r.status === 'queued' || r.status === 'running'),
    )
    if (active) {
      const drained = await drainCrawlRunToTerminal(active.id, store)
      const run = await store.getRun(active.id)
      const scope = {
        siteId: site.siteId,
        detectOrigin: site.detectOnly ? origin : null,
        userId: site.userId,
      }
      const { resolvedCount, regressedCount } = await countResolvedAndRegressed(
        store,
        scope,
        active.id,
        drained.finishedAt,
      )
      const allRuns = site.siteId
        ? await store.listRunsForSite(site.siteId)
        : await store.listRunsForDetectOrigin(site.userId, origin)
      const findings = await store.listFindings({
        siteId: site.siteId,
        detectOrigin: site.detectOnly ? origin : undefined,
        userId: site.userId,
        includeInformational: true,
      })
      const whatChanged =
        drained.status === 'complete' || drained.status === 'partial'
          ? buildWhatChangedDigest({
              currentRunId: active.id,
              previousRunId: pickPreviousTerminalRunId(allRuns, active.id),
              findings,
            })
          : null
      return {
        siteId: site.siteId,
        userId: site.userId,
        origin,
        decision: { action: 'run' },
        resumed: true,
        runId: active.id,
        status: drained.status,
        finishedAt: drained.finishedAt,
        urlsFound: run?.urlsFound,
        urlsDiscovered: run?.urlsDiscovered,
        urlsCrawled: run?.urlsCrawled,
        pagesRendered: run?.pagesRendered,
        pagesRenderFailed: run?.pagesRenderFailed,
        urlCap: run?.urlCap ?? null,
        isPartial: run?.isPartial,
        coverageNotes: run?.coverageNotes,
        resolvedCount,
        regressedCount,
        whatChanged,
      }
    }
  }

  if (decision.action === 'skip') {
    return {
      siteId: site.siteId,
      userId: site.userId,
      origin,
      decision,
    }
  }

  const dailyLimit =
    opts?.dailyLimit ??
    (await crawlDailyLimitForUser({
      userId: site.userId,
      email: site.email,
    }))
  const reserve = opts?.reserve ?? reserveCrawlStart
  const release = opts?.release ?? releaseCrawlStart
  const reservation = await reserve(site.userId, dailyLimit)
  if (!reservation.allowed) {
    return {
      siteId: site.siteId,
      userId: site.userId,
      origin,
      decision: {
        action: 'skip',
        reason: 'crawl_quota',
        detail: reservation.blockedReason || 'Daily crawl quota reached.',
      },
    }
  }

  const pageQuota =
    opts?.maxPages != null && opts.planLabel
      ? { maxPages: opts.maxPages, planLabel: opts.planLabel }
      : await crawlPageQuotaForUser({
          userId: site.userId,
          email: site.email,
        })

  let runId: string
  try {
    ;({ runId } = await startCrawlRun({
      siteId: site.detectOnly ? null : site.siteId,
      userId: site.userId,
      origin,
      detectOnly: site.detectOnly === true,
      store,
      maxUrls: pageQuota.maxPages,
      planPageLimit: { planLabel: pageQuota.planLabel },
      trigger: 'scheduled',
    }))
  } catch (err) {
    await release(site.userId)
    return {
      siteId: site.siteId,
      userId: site.userId,
      origin,
      decision: { action: 'run' },
      error: err instanceof Error ? err.message : String(err),
    }
  }

  const drained = await drainCrawlRunToTerminal(runId, store)
  const run = await store.getRun(runId)
  const { resolvedCount, regressedCount } = await countResolvedAndRegressed(
    store,
    {
      siteId: site.siteId,
      detectOrigin: site.detectOnly ? origin : null,
      userId: site.userId,
    },
    runId,
    drained.finishedAt,
  )

  const allRuns = site.siteId
    ? await store.listRunsForSite(site.siteId)
    : await store.listRunsForDetectOrigin(site.userId, origin)
  const findings = await store.listFindings({
    siteId: site.siteId,
    detectOrigin: site.detectOnly ? origin : undefined,
    userId: site.userId,
    includeInformational: true,
  })
  const whatChanged =
    drained.status === 'complete' || drained.status === 'partial'
      ? buildWhatChangedDigest({
          currentRunId: runId,
          previousRunId: pickPreviousTerminalRunId(allRuns, runId),
          findings,
        })
      : null

  return {
    siteId: site.siteId,
    userId: site.userId,
    origin,
    decision: { action: 'run' },
    resumed: false,
    runId,
    status: drained.status,
    finishedAt: drained.finishedAt,
    urlsFound: run?.urlsFound,
    urlsDiscovered: run?.urlsDiscovered,
    urlsCrawled: run?.urlsCrawled,
    pagesRendered: run?.pagesRendered,
    pagesRenderFailed: run?.pagesRenderFailed,
    urlCap: run?.urlCap ?? null,
    isPartial: run?.isPartial,
    coverageNotes: run?.coverageNotes,
    resolvedCount,
    regressedCount,
    whatChanged,
    error:
      drained.status === 'failed'
        ? run?.errorDetail || 'scheduled crawl failed'
        : undefined,
  }
}

/**
 * Cron entry: process many sites. Caps how many *new* starts per invocation
 * so Hobby maxDuration stays honest; in-progress resumes are preferred.
 */
export async function runScheduledRecrawlPass(
  sites: ScheduledSiteInput[],
  opts?: {
    store?: FindingsStore
    nowMs?: number
    maxNewStarts?: number
    domainFilter?: string | null
    resumeInProgress?: boolean
  },
): Promise<{
  processed: ScheduledRecrawlSiteResult[]
  started: number
  skipped: number
  failed: number
}> {
  const filter = opts?.domainFilter?.replace(/^www\./, '').toLowerCase() ?? null
  const maxNew = opts?.maxNewStarts ?? 3
  const processed: ScheduledRecrawlSiteResult[] = []
  let started = 0
  let skipped = 0
  let failed = 0

  for (const site of sites) {
    const host = (() => {
      try {
        return new URL(site.origin).hostname.replace(/^www\./, '').toLowerCase()
      } catch {
        return site.origin.toLowerCase()
      }
    })()
    if (filter && host !== filter && !host.endsWith(`.${filter}`)) {
      continue
    }

    // Prefer finishing in-progress scheduled runs before burning new quota.
    const result = await runScheduledRecrawlForSite(site, {
      store: opts?.store,
      nowMs: opts?.nowMs,
      resumeInProgress: opts?.resumeInProgress !== false,
    })

    if (result.decision.action === 'skip') {
      skipped += 1
      processed.push(result)
      continue
    }

    if (result.error || result.status === 'failed') {
      failed += 1
    } else if (!result.resumed) {
      started += 1
    }

    processed.push(result)

    const newStarts = processed.filter(
      (p) => p.decision.action === 'run' && p.runId && !p.resumed,
    ).length
    if (newStarts >= maxNew) break
  }

  return { processed, started, skipped, failed }
}
