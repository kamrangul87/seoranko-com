/** Fixture site wired for Fix Agent e2e (master account only). */
export const E2E_FIXTURE_SITE_ID = 'f19c49c9-31d9-4b4d-b898-c63dd8d98f6c'
export const E2E_FIXTURE_OWNER = 'kamrangul87'
export const E2E_FIXTURE_REPO = 'seoranko-fixture'
export const E2E_FIXTURE_ORIGIN = 'https://seoranko-fixture.vercel.app'
export const E2E_SEED_BRANCH = 'seed'
/** Documented seed tip; resolved live from the seed branch at run start. */
export const E2E_SEED_COMMIT_HINT = '4e4bbf9'

export const E2E_STEP_ORDER = [
  'reset_seed',
  'wait_seed_production',
  'crawl_compare',
  'fix_run_preview',
  'approve_merge_verify',
  'recrawl_assert_closed',
  'finalize',
] as const

export type E2eStepName = (typeof E2E_STEP_ORDER)[number]

/** Per-step wall-clock budget (ms). */
export const E2E_STEP_TIMEOUT_MS: Record<E2eStepName, number> = {
  reset_seed: 2 * 60 * 1000,
  wait_seed_production: 15 * 60 * 1000,
  crawl_compare: 10 * 60 * 1000,
  fix_run_preview: 20 * 60 * 1000,
  approve_merge_verify: 20 * 60 * 1000,
  recrawl_assert_closed: 10 * 60 * 1000,
  finalize: 30 * 1000,
}

/** Soft deadline inside one Vercel invocation. */
export const E2E_TICK_BUDGET_MS = 240_000
