/**
 * Contract: every Phase 2D regression fixture must appear in the merge-gating
 * Test workflow (.github/workflows/test.yml). Standalone files alone are insufficient.
 */

import { describe, expect, it } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const root = join(__dirname, '../..')

/** Paths (or directory prefixes) that must be invoked by the Test workflow. */
export const REGRESSION_FIXTURES_IN_CI = [
  // 1 Empty stored Audit restore
  'src/lib/index-diagnosis/',
  // 2 Stale Link Graph after invalid diagnosis
  'src/lib/audit-saved-stale-link-graph.test.ts',
  // 3 Migration not applied
  'src/lib/audit-persist-migration-ci.contract.test.ts',
  // 4 False verified llms/security
  'src/lib/fix-agent-live-verify.test.ts',
  // 5 PR vs direct-write status
  'src/lib/fix-agent-summary.test.ts',
  'src/lib/finding-status.test.ts',
  // 6 Subdomain connection mismatch
  'src/lib/link-graph/',
  'src/lib/site-connection-lookup.test.ts',
  // 7 Canonical normalization
  'src/lib/gsc/index-insights.test.ts',
  // 8 Domain period regex
  'src/lib/domain-period-regex.regression.test.ts',
  'src/lib/sentence-boundaries.test.ts',
  // 9 Duplicate batch upserts
  'src/lib/gsc/dedupe-metrics.test.ts',
  // 10 Low-volume discontinuity
  'src/lib/gsc/baseline-readiness.test.ts',
] as const

describe('regression fixtures gate merges to main', () => {
  it('lists every required fixture path in .github/workflows/test.yml', () => {
    const yml = readFileSync(join(root, '.github/workflows/test.yml'), 'utf8')
    expect(yml).toMatch(/branches:\s*\[main\]/)
    for (const path of REGRESSION_FIXTURES_IN_CI) {
      expect(yml, `missing CI path: ${path}`).toContain(path)
    }
  })
})
