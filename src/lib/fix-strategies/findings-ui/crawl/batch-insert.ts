/** Split an array into fixed-size chunks for batched DB writes. */
export function chunkArray<T>(items: T[], size: number): T[][] {
  const n = Math.max(1, Math.floor(size))
  const out: T[][] = []
  for (let i = 0; i < items.length; i += n) {
    out.push(items.slice(i, i + n))
  }
  return out
}
