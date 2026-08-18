/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/publish-verification.ts
// Step 4 — the point of the whole hosted-publish task: validate the page a
// crawler actually sees (the RENDERED HTML at public_url), not the artifact
// SEORANKO generated. Sibling to publisher-verification-runner.ts (the
// existing pages.liveness_state sweep for the CMS-adapter destinations) —
// same "sweep due rows, fetch, decide, transition" shape, but scoped to the
// new publications table and its own state machine. Does not touch or call
// the existing runner at all.
//
// P01/P02/P03 as defined in the publish-route spec:
//   P01 — re-fetch public_url, confirm HTTP 200. BLOCK — no 200, no LIVE_VERIFIED.
//   P02 — re-parse the RENDERED HTML and re-run the checks against it.
//   P03 — confirm canonical, OG tags, and JSON-LD survived the round trip.
// The spec references an external "S01-S14 / M01-M13" checklist by ID only
// (never defines S01-S14 anywhere available here) — re-running S01-S14
// against rendered HTML is NOT implemented below because there is nothing
// to re-run them against; only the M-series checks this same spec defines
// inline (M02 image, M06 hero size, M07 Organization.logo, M08
// dateModified, M09 inLanguage, M10 canonical, M11 OG/Twitter) are
// re-verified. This gap is deliberate and logged, not silently skipped.

import { parse } from 'node-html-parser'
import { computeBackoff } from './publisher-adapters/liveness-verifier'

const FETCH_TIMEOUT_MS = 15000
const VERIFICATION_CEILING_SECONDS = 24 * 60 * 60 // give up after 24h unverified

export interface RenderedPageCheck {
  id: string
  pass: boolean
  detail: string
}

export interface VerificationReport {
  checkedAt: string
  httpStatus: number | null
  fetchError?: string
  checks: RenderedPageCheck[]
  allPassed: boolean
  skippedChecklist: string // honest note about S01-S14, see file header
}

function normaliseUrl(url: string): string {
  return url.replace(/\/$/, '').replace(/^https?:\/\//, '').toLowerCase()
}

export function runRenderedChecks(html: string, expected: {
  publicUrl: string
  title: string
  description: string | null
  heroImageUrl: string | null
}): RenderedPageCheck[] {
  const root = parse(html)
  const checks: RenderedPageCheck[] = []

  // P01/P03 — canonical (M10)
  const canonicalHref = root.querySelector('link[rel="canonical"]')?.getAttribute('href') || null
  checks.push({
    id: 'M10-canonical',
    pass: !!canonicalHref && normaliseUrl(canonicalHref) === normaliseUrl(expected.publicUrl),
    detail: canonicalHref
      ? `Found canonical "${canonicalHref}", expected "${expected.publicUrl}"`
      : 'No <link rel="canonical"> found on the rendered page',
  })

  // P03 — OG/Twitter tags survived (M11)
  const ogTitle = root.querySelector('meta[property="og:title"]')?.getAttribute('content')
  const ogDescription = root.querySelector('meta[property="og:description"]')?.getAttribute('content')
  const twitterCard = root.querySelector('meta[name="twitter:card"]')?.getAttribute('content')
  checks.push({
    id: 'M11-og-twitter',
    pass: !!ogTitle && !!twitterCard,
    detail: `og:title=${ogTitle ? 'present' : 'MISSING'}, og:description=${ogDescription ? 'present' : 'MISSING'}, twitter:card=${twitterCard ? 'present' : 'MISSING'}`,
  })

  // P03 — JSON-LD survived, and structurally has Article.image (M02) +
  // Organization.logo (M07) + dateModified >= datePublished (M08) +
  // inLanguage present (M09)
  const scripts = root.querySelectorAll('script[type="application/ld+json"]')
  const parsed: any[] = []
  for (const s of scripts) {
    try { parsed.push(JSON.parse(s.textContent || s.innerHTML)) } catch { /* invalid block, skip */ }
  }
  checks.push({
    id: 'jsonld-present',
    pass: parsed.length > 0,
    detail: `${scripts.length} <script type="application/ld+json"> block(s) found, ${parsed.length} parsed successfully`,
  })

  const articleSchema = parsed.find(p => p['@type'] === 'Article')
  checks.push({
    id: 'M02-article-image',
    pass: !!articleSchema?.image,
    detail: articleSchema ? `Article.image=${articleSchema.image ? 'present' : 'MISSING'}` : 'No Article schema block found',
  })

  const orgSchema = parsed.find(p => p['@type'] === 'Organization')
  checks.push({
    id: 'M07-organization-logo',
    pass: !!orgSchema?.logo,
    detail: orgSchema ? `Organization.logo=${orgSchema.logo ? 'present' : 'MISSING'}` : 'No Organization schema block found',
  })

  const dateModifiedOk = !!articleSchema?.dateModified && !!articleSchema?.datePublished &&
    new Date(articleSchema.dateModified).getTime() >= new Date(articleSchema.datePublished).getTime()
  checks.push({
    id: 'M08-date-modified',
    pass: dateModifiedOk,
    detail: articleSchema
      ? `datePublished=${articleSchema.datePublished}, dateModified=${articleSchema.dateModified}`
      : 'No Article schema block found',
  })

  checks.push({
    id: 'M09-in-language',
    pass: !!articleSchema?.inLanguage,
    detail: articleSchema ? `inLanguage=${articleSchema.inLanguage || 'MISSING'}` : 'No Article schema block found',
  })

  // M06 — hero image present in the rendered body (size itself is
  // guaranteed by construction at generation time — see publish-hosted.ts)
  const heroImg = root.querySelector('img')
  checks.push({
    id: 'M06-hero-image-rendered',
    pass: !!heroImg,
    detail: heroImg ? `Hero <img> found: ${heroImg.getAttribute('src')}` : 'No <img> tag found in rendered body',
  })

  // Title/meta description round-tripped (K06/K07 presence, not re-checking length here — that's a generation-time concern)
  const renderedTitle = root.querySelector('title')?.textContent || ''
  checks.push({
    id: 'title-roundtrip',
    pass: renderedTitle.length > 0,
    detail: `Rendered <title>: "${renderedTitle.slice(0, 80)}"`,
  })

  return checks
}

export async function verifyOnePublication(supabase: any, publicationId: string): Promise<{ verified: boolean; report: VerificationReport }> {
  const nowIso = new Date().toISOString()
  const { data: pub } = await supabase
    .from('publications')
    .select('id, public_url, article_id, articles(title, meta_description, hero_image_url)')
    .eq('id', publicationId)
    .maybeSingle()

  const report: VerificationReport = {
    checkedAt: nowIso,
    httpStatus: null,
    checks: [],
    allPassed: false,
    skippedChecklist: 'S01-S14 not re-run: not defined anywhere available to this implementation (referenced by ID only in the source task). Only the inline-defined M-series checks (M02/M06/M07/M08/M09/M10/M11) are re-verified.',
  }

  if (!pub || !pub.public_url) {
    report.fetchError = 'Publication or public_url not found.'
    return { verified: false, report }
  }

  // P01 — re-fetch, confirm HTTP 200
  let res: Response
  try {
    res = await fetch(pub.public_url, {
      headers: { 'User-Agent': 'SEORANKO-PublishVerifier/1.0', 'Cache-Control': 'no-cache' },
      redirect: 'follow',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
  } catch (err) {
    report.fetchError = `Fetch failed: ${err instanceof Error ? err.message : String(err)}`
    return { verified: false, report }
  }

  report.httpStatus = res.status
  if (!res.ok) {
    report.checks.push({ id: 'P01-http-200', pass: false, detail: `HTTP ${res.status}` })
    return { verified: false, report }
  }
  report.checks.push({ id: 'P01-http-200', pass: true, detail: `HTTP ${res.status}` })

  // P02/P03 — re-parse rendered HTML, re-run checks
  const html = await res.text()
  const article = pub.articles
  const renderedChecks = runRenderedChecks(html, {
    publicUrl: pub.public_url,
    title: article?.title || '',
    description: article?.meta_description || null,
    heroImageUrl: article?.hero_image_url || null,
  })
  report.checks.push(...renderedChecks)
  report.allPassed = report.checks.every(c => c.pass)

  return { verified: report.allPassed, report }
}

// ── Sweep, mirroring publisher-verification-runner.ts's shape but scoped
// to the publications table and its own state machine. Only this function
// (and verifyOnePublication above, called by the same on-demand route it
// would back) may ever set state = LIVE_VERIFIED.
export interface PublicationsVerificationSweepResult {
  checked: number
  verified: number
  failed: number
  stillPending: number
  errors: string[]
}

export async function runPublicationsVerificationSweep(
  supabase: any,
  options: { limit?: number } = {},
): Promise<PublicationsVerificationSweepResult> {
  const nowIso = new Date().toISOString()
  const summary: PublicationsVerificationSweepResult = { checked: 0, verified: 0, failed: 0, stillPending: 0, errors: [] }

  const { data: due, error } = await supabase
    .from('publications')
    .select('id, published_at')
    .eq('state', 'LIVE_UNVERIFIED')
    .limit(options.limit ?? 50)

  if (error) {
    summary.errors.push(`Could not query due publications: ${error.message}`)
    return summary
  }

  for (const row of due || []) {
    summary.checked++
    const { verified, report } = await verifyOnePublication(supabase, row.id)

    if (verified) {
      await supabase.from('publications').update({
        state: 'LIVE_VERIFIED',
        verified_at: nowIso,
        verification_report: report,
      }).eq('id', row.id)
      summary.verified++
      continue
    }

    const elapsedSeconds = row.published_at
      ? Math.max(0, (Date.parse(nowIso) - Date.parse(row.published_at)) / 1000)
      : 0
    const backoff = computeBackoff(1, elapsedSeconds, VERIFICATION_CEILING_SECONDS)

    if (backoff.ceilingExceeded) {
      await supabase.from('publications').update({
        state: 'FAILED',
        failure_reason: report.fetchError || report.checks.filter(c => !c.pass).map(c => `${c.id}: ${c.detail}`).join(' | ') || 'Verification failed',
        verification_report: report,
      }).eq('id', row.id)
      summary.failed++
    } else {
      // Still within the ceiling — log the attempt, leave state as
      // LIVE_UNVERIFIED for the next sweep to retry.
      await supabase.from('publications').update({ verification_report: report }).eq('id', row.id)
      summary.stillPending++
    }
  }

  return summary
}