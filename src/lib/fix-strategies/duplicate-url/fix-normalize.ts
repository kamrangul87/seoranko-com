/**
 * Duplicate-URL fixers (fixture / config transforms).
 * Never import the verifier. Never propose robots.txt blocking of params.
 */

/**
 * Set `trailingSlash` in a next.config source string (topic 8).
 * Site-wide — caller must already have agreed preferred form.
 */
export function setTrailingSlashConfig(
  nextConfigSource: string,
  trailingSlash: boolean,
): { source: string; updated: boolean } {
  if (/trailingSlash\s*:/.test(nextConfigSource)) {
    return {
      source: nextConfigSource.replace(
        /trailingSlash\s*:\s*(true|false)/,
        `trailingSlash: ${trailingSlash}`,
      ),
      updated: true,
    }
  }
  // Insert into module.exports / const nextConfig object heuristically
  if (/module\.exports\s*=\s*\{/.test(nextConfigSource)) {
    return {
      source: nextConfigSource.replace(
        /module\.exports\s*=\s*\{/,
        `module.exports = {\n  trailingSlash: ${trailingSlash},`,
      ),
      updated: true,
    }
  }
  if (/const\s+nextConfig\s*=\s*\{/.test(nextConfigSource)) {
    return {
      source: nextConfigSource.replace(
        /const\s+nextConfig\s*=\s*\{/,
        `const nextConfig = {\n  trailingSlash: ${trailingSlash},`,
      ),
      updated: true,
    }
  }
  return {
    source: `${nextConfigSource.trim()}\n// trailingSlash: ${trailingSlash}\n`,
    updated: true,
  }
}

/**
 * Topic 12a — set head canonical on parameterised HTML to the clean URL.
 * Prefer this over redirect (campaign links).
 */
export function setCanonicalToCleanUrl(
  html: string,
  cleanAbsoluteUrl: string,
): { html: string; updated: boolean } {
  if (/rel\s*=\s*["'][^"']*canonical/i.test(html)) {
    const next = html.replace(
      /(<link\b[^>]*\brel\s*=\s*["'][^"']*canonical[^"']*["'][^>]*\bhref\s*=\s*["'])([^"']*)(["'][^>]*>)/gi,
      `$1${cleanAbsoluteUrl}$3`,
    )
    if (next !== html) return { html: next, updated: true }
  }
  const tag = `<link rel="canonical" href="${cleanAbsoluteUrl}">`
  if (/<\/head>/i.test(html)) {
    return {
      html: html.replace(/<\/head>/i, `  ${tag}\n</head>`),
      updated: true,
    }
  }
  return { html: `<head>${tag}</head>${html}`, updated: true }
}

/**
 * REJECTED transform — robots.txt Disallow of parameter patterns.
 * Exported only so tests can assert we never recommend it.
 */
export function rejectedRobotsTxtParamBlock(): never {
  throw new Error(
    'REJECTED: robots.txt blocking of parameters prevents Google seeing the canonical',
  )
}
