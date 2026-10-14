/**
 * Production HeartbeatDeps backed by Supabase service role + live tickers.
 */

import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { processCrawlTick } from '@/lib/fix-strategies/findings-ui/crawl/orchestrator'
import { getFindingsStore } from '@/lib/fix-strategies/findings-ui/crawl'
import {
  tickFixRun,
  defaultTickDeps,
  createLiveGithubOps,
  getFixRunStore,
  type GithubPrCreds,
} from '@/lib/fix-strategies/findings-ui/fix-run'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'
import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import { tickE2eRun } from '@/lib/fix-agent-e2e'
import { recordFixFailureSafe } from '@/lib/fix-strategies/findings-ui/fix-run/failure-learning'
import {
  TICK_LEASE_MS,
  type HeartbeatDeps,
  type RunKind,
  type ScheduledRun,
} from './heartbeat'

const FIX_ACTIVE = ['queued', 'running', 'merging'] as const
const CRAWL_ACTIVE = ['queued', 'running'] as const

function tableFor(kind: RunKind): string {
  if (kind === 'crawl') return 'fix_strategies_crawl_runs'
  if (kind === 'fix') return 'fix_strategies_runs'
  return 'e2e_runs'
}

async function resolveFixCreds(
  userId: string,
  siteId: string,
): Promise<{ creds: GithubPrCreds; domain: string } | null> {
  const sb = createServiceRoleClient()
  const { data: site } = await sb
    .from('connected_sites')
    .select('id, domain')
    .eq('id', siteId)
    .maybeSingle()
  if (!site?.domain) return null

  const owned = await findOwnedSiteConnection(sb, userId, `https://${site.domain}`)
  if (!owned || owned.cmsType !== 'github') return null

  const owner = String(
    owned.credentials.owner || owned.credentials.github_owner || '',
  )
  const repo = String(
    owned.credentials.repo || owned.credentials.github_repo || '',
  )
  const baseBranch = String(
    owned.credentials.branch || owned.credentials.baseBranch || 'main',
  )
  if (!owner || !repo) return null

  try {
    const app = await resolveGithubAppRepoCreds({
      owner,
      repo,
      baseBranch,
      userId,
    })
    if (app?.accessToken) {
      return {
        domain: site.domain,
        creds: {
          owner: app.owner,
          repo: app.repo,
          baseBranch: app.baseBranch || baseBranch,
          accessToken: app.accessToken,
        },
      }
    }
  } catch {
    /* fall through */
  }

  const token = String(
    owned.credentials.accessToken ||
      owned.credentials.token ||
      owned.credentials.github_token ||
      '',
  )
  if (!token) return null
  return {
    domain: site.domain,
    creds: { owner, repo, baseBranch, accessToken: token },
  }
}

export function createSupabaseHeartbeatDeps(): HeartbeatDeps {
  return {
    nowMs: () => Date.now(),

    async listUnfinished() {
      const sb = createServiceRoleClient()
      const out: ScheduledRun[] = []

      const { data: crawls } = await sb
        .from('fix_strategies_crawl_runs')
        .select('id, site_id, status, updated_at, tick_lease_until, last_progress_at')
        .in('status', [...CRAWL_ACTIVE])
        .limit(50)
      for (const r of crawls || []) {
        out.push({
          kind: 'crawl',
          id: String(r.id),
          siteId: r.site_id ? String(r.site_id) : null,
          lastProgressAt: String(r.last_progress_at || r.updated_at),
          leaseUntil: r.tick_lease_until ? String(r.tick_lease_until) : null,
        })
      }

      const { data: fixes } = await sb
        .from('fix_strategies_runs')
        .select(
          'id, user_id, site_id, status, phase, updated_at, tick_lease_until, last_progress_at',
        )
        .in('status', [...FIX_ACTIVE])
        .limit(50)
      for (const r of fixes || []) {
        out.push({
          kind: 'fix',
          id: String(r.id),
          userId: r.user_id ? String(r.user_id) : null,
          siteId: r.site_id ? String(r.site_id) : null,
          phase: r.phase ? String(r.phase) : null,
          lastProgressAt: String(r.last_progress_at || r.updated_at),
          leaseUntil: r.tick_lease_until ? String(r.tick_lease_until) : null,
        })
      }

      // Also surface await_approval so the skip path can see them (no tick / no watchdog).
      const { data: awaiting } = await sb
        .from('fix_strategies_runs')
        .select(
          'id, user_id, site_id, status, phase, updated_at, tick_lease_until, last_progress_at',
        )
        .eq('status', 'awaiting_approval')
        .limit(50)
      for (const r of awaiting || []) {
        out.push({
          kind: 'fix',
          id: String(r.id),
          userId: r.user_id ? String(r.user_id) : null,
          siteId: r.site_id ? String(r.site_id) : null,
          phase: 'await_approval',
          lastProgressAt: String(r.last_progress_at || r.updated_at),
          leaseUntil: r.tick_lease_until ? String(r.tick_lease_until) : null,
        })
      }

      const { data: e2es } = await sb
        .from('e2e_runs')
        .select(
          'id, site_id, status, updated_at, tick_lease_until, last_progress_at',
        )
        .eq('status', 'running')
        .limit(20)
      for (const r of e2es || []) {
        out.push({
          kind: 'e2e',
          id: String(r.id),
          siteId: r.site_id ? String(r.site_id) : null,
          lastProgressAt: String(r.last_progress_at || r.updated_at),
          leaseUntil: r.tick_lease_until ? String(r.tick_lease_until) : null,
        })
      }

      return out
    },

    async claimRun(kind, id, leaseUntilIso) {
      const sb = createServiceRoleClient()
      const { data, error } = await sb.rpc('claim_run_tick', {
        p_kind: kind,
        p_id: id,
        p_lease_until: leaseUntilIso,
      })
      if (error) {
        console.error('[heartbeat] claimRun', kind, id, error.message)
        return false
      }
      return data === true
    },

    async tickCrawl(id) {
      const store = getFindingsStore()
      const before = await store.getRun(id)
      const tick = await processCrawlTick(id, { store })
      const after = await store.getRun(id)

      // Post-crawl ticks claim 0 URL jobs but still advance phase/cursor.
      // Treating those as non-progress left last_progress_at frozen until the
      // 15m watchdog failed SPA crawls mid post-crawl.
      const postCrawlAdvanced =
        Boolean(before && after) &&
        tick.remainingQueued === 0 &&
        (before!.postCrawlPhase !== after!.postCrawlPhase ||
          JSON.stringify(before!.postCrawlCursor) !==
            JSON.stringify(after!.postCrawlCursor) ||
          before!.urlsCrawled !== after!.urlsCrawled)

      const advanced =
        tick.processedThisTick > 0 ||
        Boolean(tick.done) ||
        tick.status !== 'running' ||
        postCrawlAdvanced

      return { advanced }
    },

    async tickFix(id, userId) {
      const store = getFixRunStore()
      const run = await store.getRun(id, userId)
      if (!run) return { advanced: false }
      const resolved = await resolveFixCreds(userId, run.siteId)
      if (!resolved) {
        console.error('[heartbeat] tickFix: no github creds', { id, userId })
        return { advanced: false }
      }
      const result = await tickFixRun({
        runId: id,
        userId,
        deps: defaultTickDeps({
          ops: createLiveGithubOps(),
          creds: resolved.creds,
          siteOrigin: `https://${resolved.domain}`,
        }),
      })
      return { advanced: result.advanced }
    },

    async tickE2e(id) {
      const result = await tickE2eRun({ runId: id })
      return { advanced: result.advanced }
    },

    async markProgress(kind, id, atIso) {
      const sb = createServiceRoleClient()
      const { error } = await sb
        .from(tableFor(kind))
        .update({ last_progress_at: atIso })
        .eq('id', id)
      if (error) {
        console.error('[heartbeat] markProgress', kind, id, error.message)
      }
    },

    async failStalled(run, reason) {
      const sb = createServiceRoleClient()
      const nowIso = new Date().toISOString()

      if (run.kind === 'crawl') {
        await sb
          .from('fix_strategies_crawl_runs')
          .update({
            status: 'failed',
            finished_at: nowIso,
            error_detail: reason,
            updated_at: nowIso,
          })
          .eq('id', run.id)
          .in('status', [...CRAWL_ACTIVE])
        recordFixFailureSafe({
          siteId: run.siteId,
          runId: run.id,
          topic: 'crawl',
          verdict: 'stall',
          stage: 'stall',
          reason,
        })
        return
      }

      if (run.kind === 'fix') {
        const store = getFixRunStore()
        if (run.userId) {
          const existing = await store.getRun(run.id, run.userId)
          if (existing && existing.phase !== 'done') {
            existing.phase = 'done'
            existing.status = 'failed'
            existing.errorDetail = reason
            await store.saveRun(existing, { caller: 'heartbeat:watchdog' })
          }
        } else {
          await sb
            .from('fix_strategies_runs')
            .update({
              status: 'failed',
              phase: 'done',
              error_detail: reason,
              updated_at: nowIso,
            })
            .eq('id', run.id)
        }
        recordFixFailureSafe({
          siteId: run.siteId,
          runId: run.id,
          topic: 'fix_run',
          verdict: run.phase || 'unknown',
          stage: 'stall',
          reason,
          userId: run.userId,
        })
        return
      }

      // e2e
      const { data: e2e } = await sb
        .from('e2e_runs')
        .select('*')
        .eq('id', run.id)
        .maybeSingle()
      if (!e2e || e2e.status !== 'running') return
      const steps = Array.isArray(e2e.steps) ? [...e2e.steps] : []
      const stepName = String(e2e.current_step || 'finalize')
      const nextSteps = steps.map((s: { name?: string; status?: string }) =>
        s.name === stepName
          ? {
              ...s,
              status: 'failed',
              finishedAt: nowIso,
              error: reason,
            }
          : s,
      )
      await sb
        .from('e2e_runs')
        .update({
          status: 'failed',
          steps: nextSteps,
          first_failing_step: stepName,
          fail_reason: reason,
          finished_at: nowIso,
          updated_at: nowIso,
        })
        .eq('id', run.id)
        .eq('status', 'running')
      recordFixFailureSafe({
        siteId: run.siteId || e2e.site_id,
        runId: e2e.fix_run_id,
        topic: 'e2e',
        verdict: stepName,
        stage: 'stall',
        reason,
        e2eStep: stepName,
      })
    },
  }
}

/** Exported for tests / docs — lease duration used by production claims. */
export const PRODUCTION_TICK_LEASE_MS = TICK_LEASE_MS
