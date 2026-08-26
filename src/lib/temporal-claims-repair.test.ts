import { describe, it, expect, vi, beforeEach } from 'vitest'

const { createMock } = vi.hoisted(() => ({ createMock: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: createMock }
  },
}))

describe('repairTemporalClaims', () => {
  beforeEach(() => {
    createMock.mockReset()
  })

  it('returns the article unchanged when there are no failing temporal claims', async () => {
    const { repairTemporalClaims } = await import('./temporal-claims-repair')
    const html = '<h1>EV Charger Types</h1><p>Type 2 connectors are standard across the UK.</p>'
    const result = await repairTemporalClaims(html)
    expect(result.article).toBe(html)
    expect(result.repairedCount).toBe(0)
    expect(result.stillFailing).toHaveLength(0)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('does not flag a claim that already has a same-sentence citation (nothing to repair)', async () => {
    const { repairTemporalClaims } = await import('./temporal-claims-repair')
    const html = '<p>Currently, the grant covers <a href="https://gov.uk/grants">75% of installation costs</a>.</p>'
    const result = await repairTemporalClaims(html)
    expect(result.repairedCount).toBe(0)
    expect(result.stillFailing).toHaveLength(0)
    expect(createMock).not.toHaveBeenCalled()
  })

  it('repairs an uncited temporal claim and clears the failure', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'The grant covers 75% of installation costs, subject to change.' }],
    })
    const { repairTemporalClaims } = await import('./temporal-claims-repair')
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const result = await repairTemporalClaims(html)
    expect(result.repairedCount).toBe(1)
    expect(result.stillFailing).toHaveLength(0)
    expect(result.article).toContain('subject to change')
    expect(result.article).not.toContain('Currently, the grant covers 75%')
  })

  it('only sends the failing sentence, never the whole article', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'The grant covers 75% of installation costs, subject to change.' }],
    })
    const { repairTemporalClaims } = await import('./temporal-claims-repair')
    const html = '<h1>EV Charger Grants</h1><p>Currently, the grant covers 75% of installation costs.</p><p>Type 2 connectors are standard.</p>'
    const result = await repairTemporalClaims(html)
    expect(result.article).toContain('<h1>EV Charger Grants</h1>')
    expect(result.article).toContain('Type 2 connectors are standard.')
    const [[call]] = createMock.mock.calls
    expect(call.messages[0].content).toBe('Currently, the grant covers 75% of installation costs.')
  })

  it('rejects a patch that alters the numeric figure and surfaces the failure', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'The grant covers 40% of installation costs, subject to change.' }],
    })
    const { repairTemporalClaims } = await import('./temporal-claims-repair')
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const result = await repairTemporalClaims(html)
    expect(result.repairedCount).toBe(0)
    expect(result.stillFailing.length).toBeGreaterThan(0)
    expect(result.article).toBe(html)
  })

  it('does not enforce numeric preservation when the qualifying term is a policy word, not a figure', async () => {
    createMock.mockResolvedValue({
      content: [{ type: 'text', text: 'The application deadline applies to all eligible applicants and is reviewed periodically.' }],
    })
    const { repairTemporalClaims } = await import('./temporal-claims-repair')
    const html = '<p>Currently, the application deadline applies to all eligible applicants.</p>'
    const result = await repairTemporalClaims(html)
    expect(result.repairedCount).toBe(1)
    expect(result.stillFailing).toHaveLength(0)
  })

  it('surfaces as a real failure when Haiku errors out entirely', async () => {
    createMock.mockRejectedValue(new Error('rate limited'))
    const { repairTemporalClaims } = await import('./temporal-claims-repair')
    const html = '<p>Currently, the grant covers 75% of installation costs.</p>'
    const result = await repairTemporalClaims(html)
    expect(result.repairedCount).toBe(0)
    expect(result.stillFailing.length).toBeGreaterThan(0)
  })
})
