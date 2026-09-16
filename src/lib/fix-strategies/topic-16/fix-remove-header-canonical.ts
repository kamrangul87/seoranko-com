/**
 * Topic 16 — propose removing a Link header canonical rule.
 * Does not import the verifier. Scope must already be single-route.
 */

export function stripLinkCanonicalFromHeaderValue(
  linkHeader: string,
): { value: string | null; removed: number } {
  // Split on commas outside <>
  const parts: string[] = []
  let current = ''
  let inAngle = false
  for (const ch of linkHeader) {
    if (ch === '<') inAngle = true
    if (ch === '>') inAngle = false
    if (ch === ',' && !inAngle) {
      if (current.trim()) parts.push(current.trim())
      current = ''
      continue
    }
    current += ch
  }
  if (current.trim()) parts.push(current.trim())

  let removed = 0
  const kept = parts.filter((part) => {
    if (/\brel\s*=\s*["']?[^"';]*canonical/i.test(part)) {
      removed++
      return false
    }
    return true
  })

  if (kept.length === 0) return { value: null, removed }
  return { value: kept.join(', '), removed }
}
