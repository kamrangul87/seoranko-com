/**
 * Proof: no customer-write may run without an active gate permit.
 * Also locks inventory policy (one fix stack = fix-strategies).
 */
import { readFileSync } from 'fs'
import { join } from 'path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  CUSTOMER_WRITE_INVENTORY,
  CUSTOMER_WRITE_LOW_LEVEL_WRITERS,
  CustomerWriteGateError,
  isLegacyCustomerWritesEnabled,
  requireActiveCustomerWriteGate,
  withCustomerWriteGate,
} from './customer-write-gate'

const root = join(__dirname, '../..')

describe('customer write gate', () => {
  const prev = process.env.LEGACY_CUSTOMER_WRITES_ENABLED

  afterEach(() => {
    if (prev === undefined) delete process.env.LEGACY_CUSTOMER_WRITES_ENABLED
    else process.env.LEGACY_CUSTOMER_WRITES_ENABLED = prev
  })

  it('blocks ungated low-level writers', () => {
    expect(() => requireActiveCustomerWriteGate('test-writer')).toThrow(
      CustomerWriteGateError,
    )
    expect(() => requireActiveCustomerWriteGate('test-writer')).toThrow(
      /no active write gate/i,
    )
  })

  it('allows findings-pr-branch only with approved: true', async () => {
    await expect(
      withCustomerWriteGate('findings-pr-branch', {}, async () => 'x'),
    ).rejects.toThrow(/approved/i)

    const out = await withCustomerWriteGate(
      'findings-pr-branch',
      { approved: true },
      async () => {
        requireActiveCustomerWriteGate('findings.commitFileViaPullRequest')
        return 'ok'
      },
    )
    expect(out).toBe('ok')
  })

  it('allows findings-auto-merge only with autoMergeGatesOk', async () => {
    await expect(
      withCustomerWriteGate('findings-auto-merge', {}, async () => 'x'),
    ).rejects.toThrow(/auto_merge_enabled/i)

    const out = await withCustomerWriteGate(
      'findings-auto-merge',
      { autoMergeGatesOk: true },
      async () => {
        requireActiveCustomerWriteGate('findings.mergePullRequest')
        return 'merged'
      },
    )
    expect(out).toBe('merged')
  })

  it('disables legacy purposes unless LEGACY_CUSTOMER_WRITES_ENABLED', async () => {
    delete process.env.LEGACY_CUSTOMER_WRITES_ENABLED
    expect(isLegacyCustomerWritesEnabled()).toBe(false)

    await expect(
      withCustomerWriteGate('legacy-direct-push', {}, async () => 'x'),
    ).rejects.toThrow(/Legacy customer write/i)

    process.env.LEGACY_CUSTOMER_WRITES_ENABLED = '1'
    expect(isLegacyCustomerWritesEnabled()).toBe(true)
    const out = await withCustomerWriteGate('legacy-direct-push', {}, async () => {
      requireActiveCustomerWriteGate('github-adapter.commitFileChange')
      return 'legacy-ok'
    })
    expect(out).toBe('legacy-ok')
  })

  it('inventory: only fix-strategies paths are allowed-gated; legacy is disabled or no-write', () => {
    for (const row of CUSTOMER_WRITE_INVENTORY) {
      if (row.stack === 'fix-strategies') {
        expect(row.finalState).toBe('allowed-gated')
      } else if (row.finalState === 'no-write') {
        expect(row.writes.toLowerCase()).toMatch(/none/)
      } else {
        expect(row.finalState).toBe('disabled-behind-flag')
      }
    }
    const allowed = CUSTOMER_WRITE_INVENTORY.filter(
      (r) => r.finalState === 'allowed-gated',
    )
    expect(allowed.map((a) => a.id).sort()).toEqual([
      'findings-auto-merge',
      'findings-commit-pr',
    ])
  })

  it('every listed low-level writer source calls requireActiveCustomerWriteGate', () => {
    const sources: Record<string, string> = {
      'github-adapter.putContentsFile': 'src/lib/site-adapters/github-adapter.ts',
      'github-adapter.commitFileChange': 'src/lib/site-adapters/github-adapter.ts',
      'shopify-adapter.updateBody': 'src/lib/site-adapters/shopify-adapter.ts',
      'webflow-adapter.publishSite': 'src/lib/site-adapters/webflow-adapter.ts',
      'webflow-adapter.writeBody': 'src/lib/site-adapters/webflow-adapter.ts',
      'wordpress-connector.updateContent': 'src/lib/wordpress-connector.ts',
      'universal-tag-adapter.injectSchema':
        'src/lib/site-adapters/universal-tag-adapter.ts',
      'github-publisher.publish': 'src/lib/publisher-adapters/github-publisher.ts',
      'wordpress-publisher.publish':
        'src/lib/publisher-adapters/wordpress-publisher.ts',
      'shopify-publisher.publish': 'src/lib/publisher-adapters/shopify-publisher.ts',
      'webflow-publisher.publish': 'src/lib/publisher-adapters/webflow-publisher.ts',
      'universal-tag-publisher.publish':
        'src/lib/publisher-adapters/universal-tag-publisher.ts',
      'findings.commitFileViaPullRequest':
        'src/lib/fix-strategies/findings-ui/fix-flow/github-pr-commit.ts',
      'findings.mergePullRequest':
        'src/lib/fix-strategies/findings-ui/fix-flow/github-pr-merge.ts',
      'findings.openRevertPullRequest':
        'src/lib/fix-strategies/findings-ui/fix-flow/github-pr-merge.ts',
      'site-audit/fix.pushToGithub': 'src/app/api/site-audit/fix/route.ts',
    }

    for (const writer of CUSTOMER_WRITE_LOW_LEVEL_WRITERS) {
      const file = sources[writer]
      expect(file, writer).toBeTruthy()
      const src = readFileSync(join(root, file), 'utf8')
      expect(src, writer).toMatch(/requireActiveCustomerWriteGate/)
    }
  })
})
