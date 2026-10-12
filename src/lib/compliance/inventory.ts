/**
 * Site-level Privacy & Consent inventory from crawled pages.
 */

import {
  detectConsentSignal,
  rollupConsentSignals,
  type ConsentSignal,
} from './consent-signal'
import {
  extractPageSignals,
  matchVendorsOnPage,
  type DetectedVendorHit,
  type PageSignals,
} from './extract-signals'
import type { VendorSignature } from './vendor-signatures'

export type InventoryPageInput = {
  url: string
  html: string
  headers?: Headers | null
}

export type DetectedVendorSummary = {
  vendor: VendorSignature
  pages: string[]
  matchKinds: string[]
}

export type SiteInventory = {
  vendors: DetectedVendorSummary[]
  cookies: string[]
  consent: ConsentSignal
  pageSignals: PageSignals[]
  hits: DetectedVendorHit[]
}

export function buildSiteInventory(pages: InventoryPageInput[]): SiteInventory {
  const pageSignals: PageSignals[] = []
  const hits: DetectedVendorHit[] = []
  const consentPerPage: ConsentSignal[] = []
  const cookieSet = new Set<string>()

  for (const p of pages) {
    const signals = extractPageSignals(p.url, p.html, p.headers)
    pageSignals.push(signals)
    for (const c of signals.cookieNames) cookieSet.add(c)
    hits.push(...matchVendorsOnPage(signals))
    consentPerPage.push(detectConsentSignal(p.html))
  }

  const byId = new Map<string, DetectedVendorSummary>()
  for (const hit of hits) {
    const existing = byId.get(hit.vendor.id)
    if (!existing) {
      byId.set(hit.vendor.id, {
        vendor: hit.vendor,
        pages: [hit.pageUrl],
        matchKinds: [hit.matchKind],
      })
    } else {
      if (!existing.pages.includes(hit.pageUrl)) existing.pages.push(hit.pageUrl)
      if (!existing.matchKinds.includes(hit.matchKind)) {
        existing.matchKinds.push(hit.matchKind)
      }
    }
  }

  return {
    vendors: [...byId.values()].sort((a, b) =>
      a.vendor.id.localeCompare(b.vendor.id),
    ),
    cookies: [...cookieSet].sort(),
    consent: rollupConsentSignals(consentPerPage),
    pageSignals,
    hits,
  }
}
