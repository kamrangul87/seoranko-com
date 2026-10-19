import { describe, expect, it } from 'vitest'
import { chunkArray } from './batch-insert'

describe('chunkArray', () => {
  it('batches rows so 1466 evidence inserts are not one-by-one', () => {
    const rows = Array.from({ length: 1466 }, (_, i) => i)
    const chunks = chunkArray(rows, 200)
    expect(chunks).toHaveLength(8)
    expect(chunks[0]).toHaveLength(200)
    expect(chunks[7]).toHaveLength(66)
    expect(chunks.flat()).toHaveLength(1466)
  })
})
