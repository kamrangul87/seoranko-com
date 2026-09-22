/**
 * Opt-in auto-merge after preview verify.
 *
 * Merges a customer-repo PR only when:
 * - connected site has auto_merge_enabled (default OFF)
 * - finding is auto-fixable (not human-review / report-only)
 * - CI is green
 * - preview verifier passed against real page content (auth-wall guard)
 * - single-file blast radius (no site-wide config / shared layouts)
 *
 * After merge: production verify. On failure → open revert PR + flag.
 */

import type { UiFinding, FixFlowState, FindingSurfaceClass } from '../types'
import type { PersistedFindingRow } from '../crawl/constants'
import { canOfferFix } from '../buckets'
import type { FixFlowRecord } from './persist'
import { getFixFlowStore } from './persist'
import type { GithubPrCreds } from './github-pr-commit'
import { assessSingleFileBlastRadius } from './blast-radius'
import { listPullRequestFiles, waitForPrCiGreen } from './pr-ci-status'
import { mergePullRequest, openRevertPullRequest } from './github-pr-merge'
import { verifyFindingLive } from './verify-live'
import { appendOutcomeRecordLocal } from './outcome-record'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import { findOwnedSiteConnection } from '@/lib/site-connection-lookup'
import { normaliseDomain } from '@/lib/connected-sites'

export type AutoMergeGateResult =
  | { allowed: true }
  | { allowed: false; reason: string }

export function evaluateAutoMergeVerdictGate(
  finding: Pick<
    UiFinding | PersistedFindingRow,
    'surfaceClass' | 'autoFixable' | 'reportOnly' | 'verdict'
  >,
): AutoMergeGateResult {
  if (finding.reportOnly) {
    return { allowed: false, reason: 'report-only findings never auto-merge' }
  }
  if (!finding.autoFixable) {
    return { allowed: false, reason: 'finding is not auto-fixable' }
  }
  if (!canOfferFix(finding.surfaceClass as FindingSurfaceClass)) {
    return {
      allowed: false,
      reason: `surfaceClass=${finding.surfaceClass} — only auto-fixable may auto-merge`,
    }
  }
  if (
    finding.verdict.startsWith('human-review') ||
    finding.verdict.startsWith('report-')
  ) {
    return {
      allowed: false,
      reason: `verdict ${finding.verdict} is not auto-merge eligible`,
    }
  }
  return { allowed: true }
}

/** Read auto_merge_enabled for the finding's site (default false). */
export async function resolveSiteAutoMergeEnabled(input: {
  userId: string
  siteId?: string | null
  pageUrl?: string | null
  /** Test / operator override — still requires every other gate. */
  override?: boolean | null
}): Promise<{ enabled: boolean; source: string }> {
  if (input.override === true) {
    return { enabled: true, source: 'override' }
  }
  if (input.override === false) {
    return { enabled: false, source: 'override' }
  }

  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
    !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()
  ) {
    return { enabled: false, source: 'default-off-no-db' }
  }

  try {
    const supabase = createServiceRoleClient()

    if (input.siteId) {
      const { data } = await supabase
        .from('connected_sites')
        .select('auto_merge_enabled, domain')
        .eq('id', input.siteId)
        .eq('user_id', input.userId)
        .maybeSingle()
      if (data) {
        return {
          enabled: Boolean(data.auto_merge_enabled),
          source: `connected_sites:${data.domain}`,
        }
      }
    }

    if (input.pageUrl) {
      const owned = await findOwnedSiteConnection(
        supabase,
        input.userId,
        input.pageUrl,
      )
      if (owned) {
        const { data } = await supabase
          .from('connected_sites')
          .select('auto_merge_enabled, domain')
          .eq('id', owned.siteId)
          .maybeSingle()
        if (data) {
          return {
            enabled: Boolean(data.auto_merge_enabled),
            source: `connected_sites:${data.domain}`,
          }
        }
      }

      // Detect-only crawls have null siteId — still honour domain setting.
      try {
        const host = normaliseDomain(new URL(input.pageUrl).hostname)
        const { data } = await supabase
          .from('connected_sites')
          .select('auto_merge_enabled, domain')
          .eq('user_id', input.userId)
          .ilike('domain', host)
          .maybeSingle()
        if (data) {
          return {
            enabled: Boolean(data.auto_merge_enabled),
            source: `connected_sites:${data.domain}`,
          }
        }
      } catch {
        /* ignore */
      }
    }
  } catch {
    return { enabled: false, source: 'default-off-lookup-error' }
  }

  return { enabled: false, source: 'default-off' }
}

export type MaybeAutoMergeInput = {
  findingId: string
  userId: string
  finding: UiFinding | PersistedFindingRow
  creds: GithubPrCreds
  /** Current flow after successful preview verify. */
  previewState: FixFlowRecord
  /** Production page URL (not preview). */
  productionUrl: string
  autoMergeEnabledOverride?: boolean | null
  ciTimeoutMs?: number
  productionTimeoutMs?: number
  fetchImpl?: typeof fetch
}

/**
 * After preview verify succeeds: if site opted in and all gates hold, merge,
 * production-verify, and on failure open a revert PR + flag.
 */
export async function maybeAutoMergeAfterPreviewVerify(
  input: MaybeAutoMergeInput,
): Promise<FixFlowState> {
  const store = getFixFlowStore()
  const cur = input.previewState

  const setting = await resolveSiteAutoMergeEnabled({
    userId: input.userId,
    siteId: 'siteId' in input.finding ? input.finding.siteId : null,
    pageUrl: input.finding.pageUrl,
    override: input.autoMergeEnabledOverride,
  })

  if (!setting.enabled) {
    return store.save({
      ...cur,
      autoMerged: false,
      autoMergeBlockedReason: `auto_merge_enabled OFF (${setting.source}) — human merges`,
      needsHumanAttention: false,
    })
  }

  const verdictGate = evaluateAutoMergeVerdictGate(input.finding)
  if (!verdictGate.allowed) {
    return store.save({
      ...cur,
      autoMerged: false,
      autoMergeBlockedReason: verdictGate.reason,
    })
  }

  if (!cur.verifyOk) {
    return store.save({
      ...cur,
      autoMerged: false,
      autoMergeBlockedReason:
        'Preview verifier did not pass — refusing auto-merge',
    })
  }

  // Auth-wall / vacuous verify must already have failed verifyOk; double-check detail.
  if (
    cur.verifyDetail &&
    /authentication interstitial|auth-wall|login page/i.test(cur.verifyDetail)
  ) {
    return store.save({
      ...cur,
      autoMerged: false,
      autoMergeBlockedReason:
        'Preview verify looked like an auth wall — refusing auto-merge',
    })
  }

  if (cur.prNumber == null) {
    return store.save({
      ...cur,
      autoMerged: false,
      autoMergeBlockedReason: 'No PR number on fix-flow session',
    })
  }

  const files = await listPullRequestFiles({
    owner: input.creds.owner,
    repo: input.creds.repo,
    prNumber: cur.prNumber,
    accessToken: input.creds.accessToken,
    fetchImpl: input.fetchImpl,
  })
  const blast = assessSingleFileBlastRadius(files)
  if (!blast.ok) {
    return store.save({
      ...cur,
      autoMerged: false,
      autoMergeBlockedReason: blast.reason,
    })
  }

  const ci = await waitForPrCiGreen({
    owner: input.creds.owner,
    repo: input.creds.repo,
    prNumber: cur.prNumber,
    accessToken: input.creds.accessToken,
    timeoutMs: input.ciTimeoutMs,
    fetchImpl: input.fetchImpl,
  })
  if (!ci.ok) {
    return store.save({
      ...cur,
      autoMerged: false,
      autoMergeBlockedReason: ci.detail,
      needsHumanAttention: !ci.pending,
      flagDetail: ci.pending
        ? null
        : `Auto-merge blocked — CI not green: ${ci.detail}`,
    })
  }

  const merged = await mergePullRequest({
    creds: input.creds,
    prNumber: cur.prNumber,
    commitTitle: `merge: SEORANKO auto-merge PR #${cur.prNumber}`,
    fetchImpl: input.fetchImpl,
  })
  if (!merged.ok) {
    return store.save({
      ...cur,
      autoMerged: false,
      autoMergeBlockedReason: merged.error,
      needsHumanAttention: true,
      flagDetail: `Auto-merge setting ON but merge API failed: ${merged.error}`,
    })
  }

  // Production verify — poll briefly for deploy, then verify live URL.
  const prod = await waitForProductionVerify({
    topicId: input.finding.topicId,
    productionUrl: input.productionUrl,
    timeoutMs: input.productionTimeoutMs ?? 180_000,
    fetchImpl: input.fetchImpl,
  })

  const detectedAt =
    'firstSeenAt' in input.finding && input.finding.firstSeenAt
      ? String(input.finding.firstSeenAt)
      : cur.approvedAt || cur.committedAt || merged.mergedAt

  if (!prod.ok) {
    const revert = await openRevertPullRequest({
      creds: input.creds,
      originalPrNumber: cur.prNumber,
      path: blast.path,
      reason: prod.detail,
      fetchImpl: input.fetchImpl,
    })

    const flagDetail = revert.ok
      ? `Production verify FAILED after auto-merge. Revert PR opened: ${revert.prUrl}. Merge the revert promptly.`
      : `Production verify FAILED after auto-merge. Revert PR FAILED to open: ${revert.error}. Manual revert required.`

    appendOutcomeRecordLocal({
      origin: originOf(input.productionUrl),
      topicId: input.finding.topicId,
      verdict: input.finding.verdict,
      pageUrl: input.productionUrl,
      kind: input.finding.kind,
      detectedAt,
      fixedAt: merged.mergedAt,
      prUrl: cur.prUrl || '',
      prNumber: cur.prNumber,
      mergeSha: merged.mergeSha,
      autoMerged: true,
      productionVerify: 'FAILED',
      productionVerifyDetail: prod.detail,
      productionVerifiedAt: new Date().toISOString(),
      revertPrUrl: revert.ok ? revert.prUrl : null,
      outcome: 'production_verify_failed_revert_opened',
      fixDetail: cur.commitDetail || undefined,
    })

    return store.save({
      ...cur,
      step: 'failed',
      autoMerged: true,
      mergedAt: merged.mergedAt,
      mergeSha: merged.mergeSha,
      productionVerifyOk: false,
      productionVerifyDetail: prod.detail,
      revertPrUrl: revert.ok ? revert.prUrl : null,
      revertPrNumber: revert.ok ? revert.prNumber : null,
      needsHumanAttention: true,
      flagDetail,
      autoMergeBlockedReason: null,
      errorDetail: flagDetail,
    })
  }

  appendOutcomeRecordLocal({
    origin: originOf(input.productionUrl),
    topicId: input.finding.topicId,
    verdict: input.finding.verdict,
    pageUrl: input.productionUrl,
    kind: input.finding.kind,
    detectedAt,
    fixedAt: merged.mergedAt,
    prUrl: cur.prUrl || '',
    prNumber: cur.prNumber,
    mergeSha: merged.mergeSha,
    autoMerged: true,
    productionVerify: 'OK',
    productionVerifyDetail: prod.detail,
    productionVerifiedAt: new Date().toISOString(),
    outcome: 'closed',
    fixDetail: cur.commitDetail || undefined,
  })

  return store.save({
    ...cur,
    step: 'verified',
    autoMerged: true,
    mergedAt: merged.mergedAt,
    mergeSha: merged.mergeSha,
    productionVerifyOk: true,
    productionVerifyDetail: prod.detail,
    needsHumanAttention: false,
    flagDetail: null,
    autoMergeBlockedReason: null,
    verifyDetail: `${cur.verifyDetail || ''} | production: ${prod.detail}`,
  })
}

async function waitForProductionVerify(input: {
  topicId: string
  productionUrl: string
  timeoutMs: number
  fetchImpl?: typeof fetch
}): Promise<{ ok: boolean; detail: string }> {
  const fetchImpl = input.fetchImpl ?? fetch
  const started = Date.now()
  let last = { ok: false, detail: 'not attempted' }
  while (Date.now() - started < input.timeoutMs) {
    const result = await verifyFindingLive({
      topicId: input.topicId,
      liveUrl: input.productionUrl,
      fetchImpl,
    })
    last = { ok: result.ok, detail: result.detail }
    if (result.ok) return last
    // Auth wall on production is a hard fail (should not happen on public sites).
    if (/authentication interstitial/i.test(result.detail)) {
      return last
    }
    await new Promise((r) => setTimeout(r, 8_000))
  }
  return {
    ok: false,
    detail: `Production verify did not pass within ${input.timeoutMs}ms: ${last.detail}`,
  }
}

function originOf(url: string): string {
  try {
    return new URL(url).origin
  } catch {
    return url
  }
}
