import { beforeEach, describe, expect, it } from 'vitest'
import {
  createMemoryFindingsStore,
  resetMemoryFindingsStore,
  useMemoryFindingsStore,
} from './index'
import { findingAcceptanceFingerprint } from '../acceptance-fingerprint'
import type { RolledPersistCandidate } from './run-detectors'

function finding(
  overrides: Partial<RolledPersistCandidate> = {},
): RolledPersistCandidate {
  return {
    topicId: '38',
    kind: 'structured-data/contradicts-visible-page',
    verdict: 'human-review-entity-url-mismatch',
    severity: 'high',
    detail: 'Primary entity url mismatch',
    pageUrl: 'https://example.com/privacy',
    declarationSite: null,
    rollupKey: '38:privacy',
    affectedUrlCount: 1,
    rolledUp: false,
    bucket: 'actionable',
    autoFixable: false,
    reportOnly: true,
    surfaceClass: 'human-review',
    proposedDiff: null,
    evidenceValues: {
      left: 'https://example.com/',
      right: 'https://example.com/privacy',
    },
    sourceRows: [],
    ...overrides,
  }
}

describe('Mark as OK acceptance', () => {
  beforeEach(() => {
    resetMemoryFindingsStore()
    useMemoryFindingsStore()
  })

  it('accepts and un-accepts a finding; fingerprint pins the observation', async () => {
    const store = createMemoryFindingsStore()
    const run = await store.createRun({
      siteId: 'site-a',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: run.id,
      findings: [finding()],
      internalEvidence: [],
    })
    const rows = await store.listFindings({
      siteId: 'site-a',
      includeInformational: true,
    })
    expect(rows).toHaveLength(1)
    const id = rows[0]!.id

    const accepted = await store.setFindingAccepted({
      findingId: id,
      accepted: true,
      userId: 'user-a',
    })
    expect(accepted?.acceptedAt).toBeTruthy()
    expect(accepted?.acceptedBy).toBe('user-a')
    expect(accepted?.acceptedFingerprint).toBe(
      findingAcceptanceFingerprint({
        detail: 'Primary entity url mismatch',
        pageUrl: 'https://example.com/privacy',
        evidenceValues: {
          left: 'https://example.com/',
          right: 'https://example.com/privacy',
        },
      }),
    )

    const cleared = await store.setFindingAccepted({
      findingId: id,
      accepted: false,
      userId: 'user-a',
    })
    expect(cleared?.acceptedAt).toBeNull()
    expect(cleared?.acceptedBy).toBeNull()
    expect(cleared?.acceptedFingerprint).toBeNull()
  })

  it('clears acceptance when upsert fingerprint drifts', async () => {
    const store = createMemoryFindingsStore()
    const run1 = await store.createRun({
      siteId: 'site-a',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: run1.id,
      findings: [
        finding({
          detail: 'old detail',
          evidenceValues: { left: 'a', right: 'b' },
        }),
      ],
      internalEvidence: [],
    })
    const id = (await store.listFindings({ siteId: 'site-a', includeInformational: true }))[0]!
      .id
    await store.setFindingAccepted({
      findingId: id,
      accepted: true,
      userId: 'user-a',
    })

    const run2 = await store.createRun({
      siteId: 'site-a',
      userId: 'user-a',
      origin: 'https://example.com',
    })
    await store.upsertFindings({
      siteId: 'site-a',
      userId: 'user-a',
      runId: run2.id,
      findings: [
        finding({
          detail: 'new detail after page change',
          evidenceValues: { left: 'a', right: 'b' },
        }),
      ],
      internalEvidence: [],
    })
    const after = await store.getFinding(id)
    expect(after?.acceptedAt).toBeNull()
    expect(after?.detail).toBe('new detail after page change')
  })
})
