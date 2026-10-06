import { describe, expect, it } from 'vitest'
import { HOMEPAGE_COPY } from '@/lib/homepage-copy'
import { SEORANKO_FREE_PLAN, SEORANKO_PLANS } from '@/lib/stripe/plans'
import {
  PROOF_EXAMPLES,
  PROOF_SITE_HOST,
  PROOF_VERIFIED_FIX_COUNT,
} from '@/lib/proof-examples'
import {
  LOGIN_METADATA,
  REPORT_METADATA,
  ROOT_METADATA,
  SIGNUP_METADATA,
} from '@/lib/site-metadata'

/** Explicit allowlist — POSITIONING.md refusal copy that mentions E-E-A-T. */
const ALLOWLISTED_STRINGS = new Set([
  "No invented E-E-A-T score, no keyword-cannibalisation verdicts. Where Google says a check isn't machine-checkable, we say so instead of pretending.",
])

const BANNED_PUBLIC_COPY_RE =
  /\b(rank(s|ing|ings)?|traffic|visibility|penalt(y|ies)|email digest)\b/i

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === 'string') {
    out.push(value)
    return out
  }
  if (Array.isArray(value)) {
    for (const item of value) collectStrings(item, out)
    return out
  }
  if (value && typeof value === 'object') {
    for (const v of Object.values(value as Record<string, unknown>)) {
      collectStrings(v, out)
    }
  }
  return out
}

describe('public-site truth guard', () => {
  it('rejects banned claim words in homepage, plans, proof, and root metadata', () => {
    const strings = [
      ...collectStrings(HOMEPAGE_COPY),
      ...collectStrings(SEORANKO_PLANS),
      ...collectStrings(SEORANKO_FREE_PLAN),
      ...collectStrings(PROOF_EXAMPLES),
      String(PROOF_VERIFIED_FIX_COUNT),
      PROOF_SITE_HOST,
      ...collectStrings(ROOT_METADATA),
      ...collectStrings(LOGIN_METADATA),
      ...collectStrings(SIGNUP_METADATA),
      ...collectStrings(REPORT_METADATA),
    ]

    const offenders: string[] = []
    for (const s of strings) {
      if (ALLOWLISTED_STRINGS.has(s)) continue
      if (BANNED_PUBLIC_COPY_RE.test(s)) offenders.push(s)
    }

    expect(offenders).toEqual([])
  })

  it('keeps the E-E-A-T refusal line on the allowlist and on the homepage', () => {
    const refusal = HOMEPAGE_COPY.features.find((f) => f.title === "What we won't guess at")
    expect(refusal?.desc).toBe(
      "No invented E-E-A-T score, no keyword-cannibalisation verdicts. Where Google says a check isn't machine-checkable, we say so instead of pretending.",
    )
    expect(ALLOWLISTED_STRINGS.has(refusal!.desc)).toBe(true)
  })

  it('shows per-plan display page caps without email digest', () => {
    expect(SEORANKO_PLANS.seoranko_starter.features[0]).toBe('Up to 100 pages per crawl')
    expect(SEORANKO_PLANS.seoranko_pro.features[0]).toBe('Up to 500 pages per crawl')
    expect(SEORANKO_PLANS.seoranko_agency.features[0]).toBe('Up to 2000 pages per crawl')
    for (const plan of Object.values(SEORANKO_PLANS)) {
      expect(plan.features.join(' ')).not.toMatch(/email digest/i)
      expect(plan.features.join(' ')).toMatch(/Weekly re-crawl with an in-product report/)
    }
  })
})
