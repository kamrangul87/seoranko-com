/**
 * Merge security headers into vercel.json or next.config.js for Fix Agent.
 * X-Frame-Options + X-Content-Type-Options are safe to ship without discovery.
 * CSP is passed as an optional report-only header value (no header name).
 */

export type SecurityHeaderSpec = {
  key: string
  value: string
}

export const IMMEDIATE_SECURITY_HEADERS: SecurityHeaderSpec[] = [
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
]

export function mergeVercelJsonHeaders(
  content: string,
  headers: SecurityHeaderSpec[],
): { content: string; changed: boolean; summary: string } {
  let parsed: {
    headers?: Array<{ source?: string; headers?: Array<{ key: string; value: string }> }>
  }
  try {
    parsed = content.trim() ? (JSON.parse(content) as typeof parsed) : {}
  } catch {
    return { content, changed: false, summary: 'Could not parse vercel.json as JSON.' }
  }

  if (!Array.isArray(parsed.headers)) parsed.headers = []
  let route = parsed.headers.find((h) => h.source === '/(.*)')
  if (!route) {
    route = { source: '/(.*)', headers: [] }
    parsed.headers.push(route)
  }
  if (!Array.isArray(route.headers)) route.headers = []

  const added: string[] = []
  const updated: string[] = []
  for (const h of headers) {
    const existing = route.headers.find((x) => x.key.toLowerCase() === h.key.toLowerCase())
    if (existing) {
      if (existing.value === h.value) continue
      existing.value = h.value
      updated.push(h.key)
    } else {
      route.headers.push({ key: h.key, value: h.value })
      added.push(h.key)
    }
  }

  if (added.length === 0 && updated.length === 0) {
    return {
      content,
      changed: false,
      summary: 'Security headers already present in vercel.json.',
    }
  }

  return {
    content: `${JSON.stringify(parsed, null, 2)}\n`,
    changed: true,
    summary: [
      added.length ? `Added ${added.join(', ')}` : null,
      updated.length ? `Updated ${updated.join(', ')}` : null,
    ]
      .filter(Boolean)
      .join('; ') + ' in vercel.json.',
  }
}

function headersAlreadyMatch(content: string, headers: SecurityHeaderSpec[]): boolean {
  return headers.every((h) => {
    const keyEsc = h.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const valEsc = h.value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const reKey = new RegExp(`['"]?key['"]?\\s*:\\s*['"]${keyEsc}['"]`, 'i')
    const rePair = new RegExp(
      `['"]?key['"]?\\s*:\\s*['"]${keyEsc}['"][\\s\\S]{0,80}['"]?value['"]?\\s*:\\s*['"]${valEsc}['"]`,
      'i',
    )
    const reNext = new RegExp(
      `['"]${keyEsc}['"]\\s*:\\s*['"]${valEsc}['"]`,
      'i',
    )
    return (reKey.test(content) && rePair.test(content)) || reNext.test(content)
  })
}

export function mergeNextConfigHeaders(
  content: string,
  headers: SecurityHeaderSpec[],
): { content: string; changed: boolean; summary: string } {
  if (headersAlreadyMatch(content, headers)) {
    return { content, changed: false, summary: 'Security headers already present in next.config.' }
  }

  const entries = headers
    .map((h) => `          { key: '${h.key}', value: '${h.value.replace(/'/g, "\\'")}' }`)
    .join(',\n')

  const headersBlock = `  async headers() {
    return [
      {
        source: '/(.*)',
        headers: [
${entries},
        ],
      },
    ]
  },`

  // Merge into existing headers() return array
  if (/async\s+headers\s*\(\s*\)/i.test(content) && /source:\s*['"]\/\(\.\*\)['"]/i.test(content)) {
    let next = content
    let changed = false
    for (const h of headers) {
      const keyEsc = h.key.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
      if (new RegExp(`key:\\s*['"]${keyEsc}['"]`, 'i').test(next)) continue
      next = next.replace(
        /headers:\s*\[/i,
        (m) => `${m}\n          { key: '${h.key}', value: '${h.value.replace(/'/g, "\\'")}' },`,
      )
      changed = true
    }
    if (!changed) {
      return { content, changed: false, summary: 'Security headers already present in next.config.' }
    }
    return {
      content: next,
      changed: true,
      summary: `Merged security headers into existing headers() in next.config.`,
    }
  }

  if (/async\s+headers\s*\(\s*\)/i.test(content)) {
    // Has headers() but not our catch-all — prepend a route object after return [
    const next = content.replace(
      /async\s+headers\s*\(\s*\)\s*\{[\s\S]*?return\s*\[/i,
      (m) =>
        `${m}\n      {\n        source: '/(.*)',\n        headers: [\n${entries},\n        ],\n      },`,
    )
    if (next !== content) {
      return {
        content: next,
        changed: true,
        summary: 'Added catch-all security headers route to existing headers().',
      }
    }
  }

  // Insert headers() into an existing nextConfig object
  if (/const\s+nextConfig\s*=\s*\{/i.test(content)) {
    const next = content.replace(/const\s+nextConfig\s*=\s*\{/i, (m) => `${m}\n${headersBlock}`)
    return {
      content: next,
      changed: true,
      summary: 'Added headers() with security headers to next.config.',
    }
  }

  const full = `/** @type {import('next').NextConfig} */
const nextConfig = {
${headersBlock}
}

module.exports = nextConfig
`
  return {
    content: full,
    changed: true,
    summary: 'Created next.config.js with security headers().',
  }
}
