/**
 * Resolve which repo artefact controls URL-form routing (topic 8).
 *
 * Prefer an inventory of real repo files when available. Otherwise infer from
 * served HTML: Next.js apps → next.config.js; Vite/static (and unknown) →
 * vercel.json. Never hardcode a customer brand.
 */

export function resolveDuplicateUrlArtefactPath(opts?: {
  repoFiles?: string[] | null
  /** Served HTML samples from the crawl (detect Next vs static/Vite). */
  htmlSamples?: string[] | null
}): string {
  const files = (opts?.repoFiles ?? []).map((f) => f.replace(/\\/g, '/'))
  if (files.length > 0) {
    const next = files.find((f) =>
      /(^|\/)next\.config\.(js|mjs|cjs|ts)$/i.test(f),
    )
    if (next) {
      const base = next.split('/').pop()
      return base ?? 'next.config.js'
    }
    const vercel = files.find((f) => /(^|\/)vercel\.json$/i.test(f))
    if (vercel) return 'vercel.json'
  }

  const html = (opts?.htmlSamples ?? []).join('\n')
  if (/__NEXT_DATA__|\/_next\//i.test(html)) return 'next.config.js'
  // HTML samples present and not Next → static / Vite / Vercel hosting
  if (html.trim().length > 0) return 'vercel.json'
  // No inventory and no HTML — keep historical Next default for callers that
  // have not yet threaded repo/HTML context.
  return 'next.config.js'
}
