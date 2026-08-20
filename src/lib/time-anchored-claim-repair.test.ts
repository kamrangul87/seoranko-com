import { describe, it, expect, vi, beforeEach } from 'vitest'

// vi.mock is hoisted above imports, so createMock must come from vi.hoisted —
// a plain `const createMock = vi.fn()` would be accessed before
// initialization once this module's `new Anthropic()` runs. Same pattern as
// topical-map.test.ts.
const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

const now = new Date('2026-08-13T00:00:00Z')

describe('repairTimeAnchoredClaims', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('returns the article unchanged when there are no time-anchored claims', async () => {
    const { repairTimeAnchoredClaims } = await import('./time-anchored-claim-repair')
    const html = '<h1>EV Charger Types</h1><p>Type 2 connectors are standard across the UK.</p>'
    const result = await repairTimeAnchoredClaims(html, now)
    expect(result.article).toBe(html)
    expect(result.repairedCount).toBe(0)
    expect(result.stillFailing).toHaveLength(0)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('repairs an uncited time-anchored sentence and clears the failure', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'The grant covers 75% of installation costs, subject to change.' }],
    })
    const { repairTimeAnchoredClaims } = await import('./time-anchored-claim-repair')
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const result = await repairTimeAnchoredClaims(html, now)
    expect(result.repairedCount).toBe(1)
    expect(result.stillFailing).toHaveLength(0)
    expect(result.article).toContain('subject to change')
    expect(result.article).not.toContain('Currently, the grant covers 75%')
  })

  it('only sends the failing sentence, never the whole article, and leaves other text untouched', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'The grant covers 75% of installation costs, subject to change.' }],
    })
    const { repairTimeAnchoredClaims } = await import('./time-anchored-claim-repair')
    const html = '<h1>EV Charger Grants</h1><p>Currently, the grant covers 75% of installation costs.</p><p>Type 2 connectors are standard.</p>'
    const result = await repairTimeAnchoredClaims(html, now)
    expect(result.article).toContain('<h1>EV Charger Grants</h1>')
    expect(result.article).toContain('Type 2 connectors are standard.')
    const [[call]] = createMock.mock.calls
    expect(call.messages[0].content).toBe('Currently, the grant covers 75% of installation costs.')
  })

  it('rejects a patch that changes the numeric figure and surfaces the failure', async () => {
    // Corrupts the figure — isSafeTextPatch style guard should reject this,
    // and detectTimeAnchoredClaims + validateTimeAnchoredClaims will still
    // see it as failing on every retry since nothing usable ever lands.
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'The grant covers 40% of installation costs, subject to change.' }],
    })
    const { repairTimeAnchoredClaims } = await import('./time-anchored-claim-repair')
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const result = await repairTimeAnchoredClaims(html, now)
    expect(result.repairedCount).toBe(0)
    expect(result.stillFailing.length).toBeGreaterThan(0)
    expect(result.article).toBe(html)
  })

  it('does not call the model again once no progress is made in a pass', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'Currently, the grant covers 75% of installation costs.' }], // identical to original — no-op
    })
    const { repairTimeAnchoredClaims } = await import('./time-anchored-claim-repair')
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    await repairTimeAnchoredClaims(html, now)
    // First pass calls once, finds no progress, and stops — it should not
    // burn through MAX_REPAIR_ATTEMPTS retries hammering the same no-op.
    expect(createMock).toHaveBeenCalledTimes(1)
  })

  it('retries at most twice when each patch lands but still fails validation, then gives up', async () => {
    // Each rewrite is a safe, number-preserving patch, but still matches a
    // time-anchored pattern (still uncited) — so validation keeps failing
    // and the loop should keep retrying, capped at MAX_REPAIR_ATTEMPTS (2).
    createMock
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'The current rate is 75%, though it is reviewed periodically.' }],
      })
      .mockResolvedValueOnce({
        content: [{ type: 'text', text: 'As of 2027, the rate is 75%, though it is reviewed periodically.' }],
      })
    const { repairTimeAnchoredClaims } = await import('./time-anchored-claim-repair')
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const result = await repairTimeAnchoredClaims(html, now)
    expect(createMock).toHaveBeenCalledTimes(2)
    expect(result.stillFailing.length).toBeGreaterThan(0)
  })

  it('surfaces as a real failure (not silently dropped) when Haiku errors out entirely', async () => {
    createMock.mockRejectedValue(new Error('rate limited'))
    const { repairTimeAnchoredClaims } = await import('./time-anchored-claim-repair')
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const result = await repairTimeAnchoredClaims(html, now)
    expect(result.repairedCount).toBe(0)
    expect(result.stillFailing.length).toBeGreaterThan(0)
  })
})
