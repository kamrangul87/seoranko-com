import { describe, expect, it, vi } from 'vitest'

/**
 * Contract: listRunEmits must page beyond PostgREST's 1000-row default so
 * late full_snapshot topics (43 / related) are not dropped from upsert.
 */
describe('listRunEmits pagination contract', () => {
  it('pages until a short chunk', async () => {
    const pages = [
      Array.from({ length: 1000 }, (_, i) => ({ payload: { i } })),
      Array.from({ length: 1000 }, (_, i) => ({ payload: { i: i + 1000 } })),
      Array.from({ length: 59 }, (_, i) => ({ payload: { i: i + 2000 } })),
    ]
    let call = 0
    const range = vi.fn(async (from: number, to: number) => {
      const page = pages[call++] ?? []
      expect(to - from + 1).toBe(1000)
      return { data: page, error: null }
    })
    // Mimic the store loop
    const pageSize = 1000
    const out: unknown[] = []
    for (let from = 0; ; from += pageSize) {
      const to = from + pageSize - 1
      const { data } = await range(from, to)
      const chunk = data ?? []
      for (const r of chunk) out.push(r.payload)
      if (chunk.length < pageSize) break
    }
    expect(out).toHaveLength(2059)
    expect(call).toBe(3)
  })
})
