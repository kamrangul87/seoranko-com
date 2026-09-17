/**
 * Topic 28 — append a Sitemap: record to an existing robots.txt body.
 * Never creates robots.txt from scratch (S23 / guard 6).
 */

import { normalizeFixStrategyUrl } from '@/lib/fix-strategies/shared/url-normalize'

/** Propose adding a Sitemap: line. Never creates robots.txt from scratch. */
export function proposeAddSitemapRecord(
  robotsBody: string | null,
  sitemapAbsoluteUrl: string,
): {
  body: string | null
  updated: boolean
  rejectedCreate: boolean
} {
  if (robotsBody == null) {
    return { body: null, updated: false, rejectedCreate: true }
  }
  const abs =
    normalizeFixStrategyUrl(sitemapAbsoluteUrl) ?? sitemapAbsoluteUrl
  if (/^\s*sitemap\s*:/im.test(robotsBody)) {
    if (robotsBody.toLowerCase().includes(abs.toLowerCase())) {
      return { body: robotsBody, updated: false, rejectedCreate: false }
    }
  }
  const trimmed = robotsBody.replace(/\s*$/, '')
  const next = `${trimmed}\nSitemap: ${abs}\n`
  return { body: next, updated: true, rejectedCreate: false }
}

/** Apply the deterministic append when autoFixable and body is known. */
export function applyAddSitemapRecord(
  robotsBody: string,
  sitemapAbsoluteUrl: string,
): { body: string; updated: boolean } {
  const result = proposeAddSitemapRecord(robotsBody, sitemapAbsoluteUrl)
  if (result.rejectedCreate || result.body == null) {
    return { body: robotsBody, updated: false }
  }
  return { body: result.body, updated: result.updated }
}

/** REJECTED — never create robots.txt just to add Sitemap:. */
export function rejectedCreateRobotsTxtForSitemap(): never {
  throw new Error(
    'REJECTED: never create a robots.txt just to add a Sitemap: record — a 404 robots.txt is normal',
  )
}
