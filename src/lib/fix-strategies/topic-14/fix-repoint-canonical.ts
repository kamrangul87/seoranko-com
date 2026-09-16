/**
 * Topic 14 — repoint or set self-referential canonical in HTML.
 * Does not import the verifier. Never writes layout-level metadata.
 */

export function setHeadCanonicalHref(
  html: string,
  newAbsoluteUrl: string,
): { html: string; updated: number } {
  let updated = 0
  const next = html.replace(
    /(<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*\bhref\s*=\s*["'])([^"']*)(["'][^>]*>)/gi,
    (_m, pre: string, _old: string, post: string) => {
      updated++
      return `${pre}${newAbsoluteUrl}${post}`
    },
  )
  // Also handle href-before-rel order
  if (updated === 0) {
    const alt = html.replace(
      /(<link\b[^>]*\bhref\s*=\s*["'])([^"']*)(["'][^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*>)/gi,
      (_m, pre: string, _old: string, post: string) => {
        updated++
        return `${pre}${newAbsoluteUrl}${post}`
      },
    )
    return { html: alt, updated }
  }
  return { html: next, updated }
}
