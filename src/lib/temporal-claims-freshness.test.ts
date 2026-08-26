import { describe, it, expect, vi } from 'vitest'
import { runTemporalClaimsFreshnessCheck } from './temporal-claims-freshness'

// Minimal fake matching only the exact chain shapes runTemporalClaimsFreshnessCheck
// calls: .from(table).select(...).lte(...).eq(...).limit(...) for the read,
// and .from(table).update(...).eq(...) for each write.
function fakeSupabase(dueRows: Array<Record<string, unknown>>) {
  const updateCalls: Array<{ table: string; patch: Record<string, unknown>; id: string }> = []
  const from = (table: string) => ({
    select: () => ({
      lte: () => ({
        eq: () => ({
          limit: async () => ({ data: dueRows }),
        }),
      }),
    }),
    update: (patch: Record<string, unknown>) => ({
      eq: async (_col: string, id: string) => {
        updateCalls.push({ table, patch, id })
        return { data: null, error: null }
      },
    }),
  })
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client: { from } as any, updateCalls }
}

const now = new Date('2026-08-24T00:00:00Z')

describe('runTemporalClaimsFreshnessCheck', () => {
  it('marks a claim whose source still resolves (200) as verified, no drift', async () => {
    const { client, updateCalls } = fakeSupabase([
      { id: 'claim-1', article_id: 'article-1', user_id: 'user-1', claim_text: 'Currently, the grant covers 75%.', source_url: 'https://gov.uk/grants' },
    ])
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200 })
    const result = await runTemporalClaimsFreshnessCheck(client, { now, fetchImpl })
    expect(result.checked).toBe(1)
    expect(result.stillResolves).toBe(1)
    expect(result.drift).toHaveLength(0)
    expect(updateCalls[0].patch).toMatchObject({ last_verified_at: now.toISOString() })
    expect(updateCalls[0].patch.status).toBeUndefined()
  })

  it('accepts a 301 redirect as still resolving', async () => {
    const { client } = fakeSupabase([
      { id: 'claim-1', article_id: 'article-1', user_id: 'user-1', claim_text: 'text', source_url: 'https://gov.uk/grants' },
    ])
    const fetchImpl = vi.fn().mockResolvedValue({ status: 301 })
    const result = await runTemporalClaimsFreshnessCheck(client, { now, fetchImpl })
    expect(result.stillResolves).toBe(1)
    expect(result.drift).toHaveLength(0)
  })

  it('flags drift and sets status to flagged when the source 404s', async () => {
    const { client, updateCalls } = fakeSupabase([
      { id: 'claim-1', article_id: 'article-1', user_id: 'user-1', claim_text: 'Currently, the grant covers 75%.', source_url: 'https://gov.uk/grants' },
    ])
    const fetchImpl = vi.fn().mockResolvedValue({ status: 404 })
    const result = await runTemporalClaimsFreshnessCheck(client, { now, fetchImpl })
    expect(result.drift).toHaveLength(1)
    expect(result.drift[0]).toMatchObject({
      claimId: 'claim-1',
      articleId: 'article-1',
      claimText: 'Currently, the grant covers 75%.',
      sourceUrl: 'https://gov.uk/grants',
    })
    expect(updateCalls[0].patch.status).toBe('flagged')
  })

  it('flags drift when the fetch itself throws (unreachable)', async () => {
    const { client } = fakeSupabase([
      { id: 'claim-1', article_id: 'article-1', user_id: 'user-1', claim_text: 'text', source_url: 'https://gov.uk/grants' },
    ])
    const fetchImpl = vi.fn().mockRejectedValue(new Error('timeout'))
    const result = await runTemporalClaimsFreshnessCheck(client, { now, fetchImpl })
    expect(result.drift).toHaveLength(1)
    expect(result.drift[0].reason).toContain('unreachable')
  })

  it('never mutates article content — only ever calls .from("temporal_claims")', async () => {
    const fromSpy = vi.fn()
    const dueRows = [{ id: 'claim-1', article_id: 'article-1', user_id: 'user-1', claim_text: 'text', source_url: 'https://gov.uk/grants' }]
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const client: any = {
      from: (table: string) => {
        fromSpy(table)
        return {
          select: () => ({ lte: () => ({ eq: () => ({ limit: async () => ({ data: dueRows }) }) }) }),
          update: () => ({ eq: async () => ({ data: null, error: null }) }),
        }
      },
    }
    const fetchImpl = vi.fn().mockResolvedValue({ status: 200 })
    await runTemporalClaimsFreshnessCheck(client, { now, fetchImpl })
    for (const call of fromSpy.mock.calls) {
      expect(call[0]).toBe('temporal_claims')
    }
    expect(fromSpy).toHaveBeenCalled()
  })

  it('checks zero claims and reports zero drift when nothing is due', async () => {
    const { client } = fakeSupabase([])
    const fetchImpl = vi.fn()
    const result = await runTemporalClaimsFreshnessCheck(client, { now, fetchImpl })
    expect(result.checked).toBe(0)
    expect(result.drift).toHaveLength(0)
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
