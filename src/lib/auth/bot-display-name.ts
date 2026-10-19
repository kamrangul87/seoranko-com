/**
 * Detects bot spam display names: 15+ letters, no spaces, mixed random case.
 * Matches the Sep 2026 signup flood pattern (e.g. XFzHtjIybtpBqAkNCCmvqM).
 * Allows normal names and long PascalCase compounds (AlexanderHamilton).
 */

export function looksLikeRandomBotDisplayName(name: string): boolean {
  const n = String(name ?? '').trim()
  if (n.length < 15) return false
  if (/\s/.test(n)) return false
  if (!/^[A-Za-z]+$/.test(n)) return false
  if (!/[a-z]/.test(n) || !/[A-Z]/.test(n)) return false

  // Real compound names without spaces are usually PascalCase word runs.
  if (/^[A-Z][a-z]+(?:[A-Z][a-z]+)+$/.test(n)) return false

  let transitions = 0
  for (let i = 1; i < n.length; i++) {
    const prevUpper = n[i - 1]! >= 'A' && n[i - 1]! <= 'Z'
    const curUpper = n[i]! >= 'A' && n[i]! <= 'Z'
    if (prevUpper !== curUpper) transitions++
  }

  // Random bots flip case often; require transitions in ≥25% of adjacent pairs.
  return transitions >= Math.max(4, Math.floor(n.length * 0.25))
}
