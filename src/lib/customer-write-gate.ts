/**
 * Customer write gate — every path that mutates a customer's site or repo
 * must run inside `withCustomerWriteGate`. Low-level writers call
 * `requireActiveCustomerWriteGate` and throw if no permit is active.
 *
 * Allowed without LEGACY flag:
 * - findings-pr-branch  (review branch + PR only; never main)
 * - findings-auto-merge (only after auto_merge_enabled + every product gate)
 *
 * Legacy RANKO / Fix Agent / site-audit / browser publish / CMS adapters:
 * disabled unless LEGACY_CUSTOMER_WRITES_ENABLED=1 (default OFF).
 *
 * Server-only: uses AsyncLocalStorage; must never enter a Client Component
 * import graph.
 */

import 'server-only'
import { AsyncLocalStorage } from 'async_hooks'

export type CustomerWritePurpose =
  | 'findings-pr-branch'
  | 'findings-auto-merge'
  | 'legacy-direct-push'
  | 'legacy-cms-publish'
  | 'legacy-dom-queue'
  | 'legacy-browser-publish'
  | 'legacy-install-pr'
  | 'operator-script'

export type CustomerWritePermit = {
  purpose: CustomerWritePurpose
  grantedAt: number
}

export class CustomerWriteGateError extends Error {
  readonly code = 'CUSTOMER_WRITE_BLOCKED'
  constructor(message: string) {
    super(message)
    this.name = 'CustomerWriteGateError'
  }
}

/** Plain-language copy for API/UI — never surface raw gate internals. */
export const CUSTOMER_WRITE_GATE_USER_MESSAGE =
  'We could not write to your repository because a safety check blocked the change. Please try Fix my site again.'

export function isCustomerWriteGateError(err: unknown): err is CustomerWriteGateError {
  return (
    err instanceof CustomerWriteGateError ||
    (err instanceof Error &&
      (err.name === 'CustomerWriteGateError' ||
        (err as { code?: string }).code === 'CUSTOMER_WRITE_BLOCKED'))
  )
}

export function customerWriteGateUserMessage(err?: unknown): string {
  if (err == null || isCustomerWriteGateError(err)) {
    return CUSTOMER_WRITE_GATE_USER_MESSAGE
  }
  if (err instanceof Error && /no active write gate|customer write blocked/i.test(err.message)) {
    return CUSTOMER_WRITE_GATE_USER_MESSAGE
  }
  return CUSTOMER_WRITE_GATE_USER_MESSAGE
}

type PermitStore = CustomerWritePermit

const storage = new AsyncLocalStorage<PermitStore>()

/** Kill-switch for pre-findings write stacks. Default OFF. */
export function isLegacyCustomerWritesEnabled(): boolean {
  const v = process.env.LEGACY_CUSTOMER_WRITES_ENABLED?.trim().toLowerCase()
  return v === '1' || v === 'true' || v === 'yes'
}

const LEGACY_PURPOSES = new Set<CustomerWritePurpose>([
  'legacy-direct-push',
  'legacy-cms-publish',
  'legacy-dom-queue',
  'legacy-browser-publish',
  'legacy-install-pr',
  'operator-script',
])

/**
 * Inventory of customer-write entry points and their final policy.
 * Kept here so tests and audits stay in sync with code.
 */
export const CUSTOMER_WRITE_INVENTORY = [
  {
    id: 'findings-commit-pr',
    path: 'src/lib/fix-strategies/findings-ui/fix-flow/github-pr-commit.ts#commitFileViaPullRequest',
    stack: 'fix-strategies',
    writes: 'GitHub review branch + open PR (never main)',
    purpose: 'findings-pr-branch' as const,
    finalState: 'allowed-gated',
  },
  {
    id: 'findings-auto-merge',
    path: 'src/lib/fix-strategies/findings-ui/fix-flow/github-pr-merge.ts#mergePullRequest',
    stack: 'fix-strategies',
    writes: 'Merge PR → default branch',
    purpose: 'findings-auto-merge' as const,
    finalState: 'allowed-gated',
  },
  {
    id: 'fix-run-pr-branch',
    path: 'src/lib/fix-strategies/findings-ui/fix-run/tick.ts#create_branch+apply+ensure_pr',
    stack: 'fix-strategies',
    writes: 'GitHub review branch + commits + open PR (never main)',
    purpose: 'findings-pr-branch' as const,
    finalState: 'allowed-gated',
  },
  {
    id: 'fix-run-merge',
    path: 'src/lib/fix-strategies/findings-ui/fix-run/tick.ts#merge',
    stack: 'fix-strategies',
    writes: 'Merge fix-run PR → default branch',
    purpose: 'findings-auto-merge' as const,
    finalState: 'allowed-gated',
  },
  {
    id: 'fix-agent',
    path: 'src/lib/fix-agent.ts#runFixAgent + github-adapter commitFileChange',
    stack: 'legacy',
    writes: 'Direct push to default branch / CMS live update',
    purpose: 'legacy-direct-push' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'fix-agent-revert',
    path: 'src/app/api/copilot/fix-agent/revert/route.ts',
    stack: 'legacy',
    writes: 'Overwrite page via adapter (direct)',
    purpose: 'legacy-direct-push' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'csp-ship-headers',
    path: 'src/app/api/copilot/csp/route.ts',
    stack: 'legacy',
    writes: 'Direct push vercel.json / next.config headers',
    purpose: 'legacy-direct-push' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'ranko-apply-site-fix',
    path: 'src/lib/site-autofix.ts#applySiteAutoFix',
    stack: 'legacy',
    writes: 'CMS/GitHub direct publish',
    purpose: 'legacy-cms-publish' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'site-audit-fix-github',
    path: 'src/app/api/site-audit/fix/route.ts#pushToGithub',
    stack: 'legacy',
    writes: 'Direct Contents PUT to named branch (often main)',
    purpose: 'legacy-direct-push' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'site-audit-sitemap-github',
    path: 'src/app/api/site-audit/generate-sitemap/route.ts',
    stack: 'legacy',
    writes: 'Direct sitemap.xml Contents PUT',
    purpose: 'legacy-direct-push' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'site-audit-apply-fix-queue',
    path: 'src/app/api/site-audit/apply-fix/route.ts',
    stack: 'legacy',
    writes: 'seo_fixes queue → seoranko.js DOM mutation',
    purpose: 'legacy-dom-queue' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'api-fixes-queue',
    path: 'src/app/api/fixes/route.ts',
    stack: 'legacy',
    writes: 'seo_fixes queue → browser DOM',
    purpose: 'legacy-dom-queue' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'publisher-adapters',
    path: 'src/lib/publisher-adapters/* + article-publisher.publishArticle',
    stack: 'legacy',
    writes: 'Live CMS publish / GitHub main Contents PUT',
    purpose: 'legacy-cms-publish' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'site-audit-browser-publish',
    path: 'src/app/dashboard/site-audit/page.tsx#handlePublish',
    stack: 'legacy',
    writes: 'Browser → GitHub main / CMS draft-or-publish',
    purpose: 'legacy-browser-publish' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'install-github-pr',
    path: 'src/app/api/install/github-pr/route.ts',
    stack: 'legacy',
    writes: 'Install-script PR (branch + PR; not main)',
    purpose: 'legacy-install-pr' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'universal-tag-queue',
    path: 'src/lib/site-adapters/universal-tag-adapter.ts#injectSchema',
    stack: 'legacy',
    writes: 'Queue DOM schema patch via universal_tag_fixes',
    purpose: 'legacy-dom-queue' as const,
    finalState: 'disabled-behind-flag',
  },
  {
    id: 'ranking-agent-autofix',
    path: 'src/app/api/ranking-agent/autofix/route.ts',
    stack: 'legacy',
    writes: 'None (returns improved HTML only)',
    purpose: 'legacy-direct-push' as const,
    finalState: 'no-write',
  },
] as const

/** Low-level writer symbols that MUST call requireActiveCustomerWriteGate. */
export const CUSTOMER_WRITE_LOW_LEVEL_WRITERS = [
  'github-adapter.putContentsFile',
  'github-adapter.commitFileChange',
  'shopify-adapter.updateBody',
  'webflow-adapter.publishSite',
  'webflow-adapter.writeBody',
  'wordpress-connector.updateContent',
  'universal-tag-adapter.injectSchema',
  'github-publisher.publish',
  'wordpress-publisher.publish',
  'shopify-publisher.publish',
  'webflow-publisher.publish',
  'universal-tag-publisher.publish',
  'findings.commitFileViaPullRequest',
  'findings.mergePullRequest',
  'findings.openRevertPullRequest',
  'fix-run.createBranch',
  'fix-run.commitFile',
  'fix-run.ensurePullRequest',
  'fix-run.mergePullRequest',
  'site-audit/fix.pushToGithub',
] as const

export function assertPurposeAllowed(
  purpose: CustomerWritePurpose,
  opts: {
    approved?: boolean
    autoMergeGatesOk?: boolean
  } = {},
): void {
  if (purpose === 'findings-pr-branch') {
    if (opts.approved !== true) {
      throw new CustomerWriteGateError(
        'findings-pr-branch requires prior approve (approved: true)',
      )
    }
    return
  }
  if (purpose === 'findings-auto-merge') {
    if (opts.autoMergeGatesOk !== true) {
      throw new CustomerWriteGateError(
        'findings-auto-merge requires auto_merge_enabled + CI + preview verify + blast-radius gates',
      )
    }
    return
  }
  if (LEGACY_PURPOSES.has(purpose)) {
    if (!isLegacyCustomerWritesEnabled()) {
      throw new CustomerWriteGateError(
        `Legacy customer write (${purpose}) disabled. ` +
          `Use fix-strategies findings flow (PR + gates). ` +
          `Set LEGACY_CUSTOMER_WRITES_ENABLED=1 only for emergency revisit.`,
      )
    }
    return
  }
  throw new CustomerWriteGateError(`Unknown write purpose: ${purpose}`)
}

/**
 * Run `fn` with an active write permit. Nested calls inherit the same permit.
 */
export async function withCustomerWriteGate<T>(
  purpose: CustomerWritePurpose,
  opts: {
    approved?: boolean
    autoMergeGatesOk?: boolean
  },
  fn: () => Promise<T>,
): Promise<T> {
  assertPurposeAllowed(purpose, opts)
  const existing = storage.getStore()
  if (existing) {
    // Nested: keep outer permit (stricter entry already checked).
    return fn()
  }
  return storage.run({ purpose, grantedAt: Date.now() }, fn)
}

/** Sync variant for sync writers (rare). */
export function withCustomerWriteGateSync<T>(
  purpose: CustomerWritePurpose,
  opts: {
    approved?: boolean
    autoMergeGatesOk?: boolean
  },
  fn: () => T,
): T {
  assertPurposeAllowed(purpose, opts)
  const existing = storage.getStore()
  if (existing) return fn()
  return storage.run({ purpose, grantedAt: Date.now() }, fn)
}

/**
 * Low-level writers MUST call this. Throws if not inside withCustomerWriteGate.
 */
export function requireActiveCustomerWriteGate(writer: string): void {
  const permit = storage.getStore()
  if (!permit) {
    throw new CustomerWriteGateError(
      `${writer}: customer write blocked — no active write gate. ` +
        `All customer writes must go through fix-strategies (PR + gates) ` +
        `or LEGACY_CUSTOMER_WRITES_ENABLED with an explicit gate purpose.`,
    )
  }
}

export function getActiveCustomerWritePermit(): CustomerWritePermit | null {
  return storage.getStore() ?? null
}

/** JSON body for API routes when legacy stack is disabled. */
export function legacyCustomerWritesDisabledBody(pathId: string) {
  return {
    error: 'Legacy customer writes are disabled',
    code: 'LEGACY_CUSTOMER_WRITES_DISABLED',
    path: pathId,
    message:
      'Direct-to-main / direct-publish paths are off. Use Findings → approve → commit (PR) → verify. ' +
      'Auto-merge only when auto_merge_enabled and every gate passes. ' +
      'Emergency revisit: LEGACY_CUSTOMER_WRITES_ENABLED=1.',
  }
}
