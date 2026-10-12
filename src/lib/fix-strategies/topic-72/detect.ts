/**
 * Topic 72 — Privacy & Consent: vendor inventory vs privacy policy + consent.
 * Static HTML only. No LLM. No market/jurisdiction default.
 */

import { buildSiteInventory, type InventoryPageInput } from '@/lib/compliance/inventory'
import {
  findPrivacyPage,
  missingPolicySections,
  SECTION_PATTERNS,
  vendorNamedOnPage,
  vendorsNamedButNotDetected,
  type PolicySectionId,
} from '@/lib/compliance/policy-diff'

export type Topic72Verdict =
  | 'human-review-no-privacy-page'
  | 'human-review-vendor-unnamed'
  | 'human-review-consent-missing'
  | 'human-review-section-missing-controller'
  | 'human-review-section-missing-contact'
  | 'human-review-section-missing-lawful-basis'
  | 'human-review-section-missing-recipients'
  | 'human-review-section-missing-international-transfers'
  | 'human-review-section-missing-retention'
  | 'human-review-section-missing-rights'
  | 'human-review-jurisdiction-not-set'
  | 'informational-vendor-named-not-detected'

export type Topic72Finding = {
  verdict: Topic72Verdict
  pageUrl: string
  detail: string
  severity: 'high' | 'moderate' | 'low' | null
  autoFixable: false
  evidenceValues: Record<string, unknown>
}

export type DetectTopic72Result = {
  findings: Topic72Finding[]
  informational: Topic72Finding[]
  inventory: ReturnType<typeof buildSiteInventory>
  privacyPageUrl: string | null
}

export type DetectTopic72Options = {
  pages: InventoryPageInput[]
  /** Required site setting — never defaulted to a country. */
  jurisdiction?: string | null
  originUrl?: string
}

const SECTION_VERDICT: Record<PolicySectionId, Topic72Verdict> = {
  controller_identity: 'human-review-section-missing-controller',
  contact: 'human-review-section-missing-contact',
  lawful_basis: 'human-review-section-missing-lawful-basis',
  recipients: 'human-review-section-missing-recipients',
  international_transfers:
    'human-review-section-missing-international-transfers',
  retention: 'human-review-section-missing-retention',
  rights: 'human-review-section-missing-rights',
}

export function detectPrivacyConsentIssues(
  opts: DetectTopic72Options,
): DetectTopic72Result {
  const findings: Topic72Finding[] = []
  const informational: Topic72Finding[] = []
  const inventory = buildSiteInventory(opts.pages)
  const origin =
    opts.originUrl ??
    (opts.pages[0]
      ? (() => {
          try {
            return new URL(opts.pages[0]!.url).origin
          } catch {
            return opts.pages[0]!.url
          }
        })()
      : 'https://example.invalid')

  const jurisdiction = (opts.jurisdiction ?? '').trim()
  if (!jurisdiction) {
    findings.push({
      verdict: 'human-review-jurisdiction-not-set',
      pageUrl: origin,
      severity: 'moderate',
      autoFixable: false,
      detail:
        'Site jurisdiction is not set. Supervisory-authority wording cannot be chosen without an explicit jurisdiction setting — there is no country default.',
      evidenceValues: {
        jurisdiction: null,
        autoFixable: false,
        surfaceClass: 'human-review',
      },
    })
  }

  const privacy = findPrivacyPage(
    opts.pages.map((p) => ({ url: p.url, html: p.html })),
  )

  if (!privacy) {
    findings.push({
      verdict: 'human-review-no-privacy-page',
      pageUrl: origin,
      severity: 'high',
      autoFixable: false,
      detail:
        'No privacy / data-protection page was found via footer link text/href or a privacy path heuristic.',
      evidenceValues: {
        autoFixable: false,
        surfaceClass: 'human-review',
        vendorsDetected: inventory.vendors.map((v) => v.vendor.id),
      },
    })
    // Still emit consent findings without a policy page.
  }

  const policyHtml = privacy?.html ?? ''
  const policyUrl = privacy?.pageUrl ?? origin

  // (b) detected vendor not named
  if (privacy) {
    for (const v of inventory.vendors) {
      if (!vendorNamedOnPage(policyHtml, v.vendor)) {
        findings.push({
          verdict: 'human-review-vendor-unnamed',
          pageUrl: policyUrl,
          severity: 'high',
          autoFixable: false,
          detail:
            `${v.vendor.displayName} was detected on the site but is not named on the privacy page.`,
          evidenceValues: {
            vendorId: v.vendor.id,
            vendorDisplayName: v.vendor.displayName,
            detectedOnPages: v.pages,
            matchKinds: v.matchKinds,
            privacyPageUrl: privacy.pageUrl,
            autoFixable: false,
            surfaceClass: 'human-review',
          },
        })
      }
    }
  }

  // (c) requires_consent vendor + no consent signal
  const consentOk =
    inventory.consent.presence === 'cmp_signature' ||
    inventory.consent.presence === 'gated_analytics'
  const needsConsent = inventory.vendors.filter((v) => v.vendor.requiresConsent)
  if (needsConsent.length > 0 && !consentOk) {
    findings.push({
      verdict: 'human-review-consent-missing',
      pageUrl: needsConsent[0]!.pages[0] ?? origin,
      severity: 'high',
      autoFixable: false,
      detail:
        `Vendors that typically require consent were detected (${needsConsent
          .map((v) => v.vendor.displayName)
          .join(', ')}) and no consent signal (CMP signature or gated analytics load) was found in static HTML. pre_consent_load=${inventory.consent.preConsentLoad}.`,
      evidenceValues: {
        consent: inventory.consent,
        vendorsRequiringConsent: needsConsent.map((v) => v.vendor.id),
        pre_consent_load: inventory.consent.preConsentLoad,
        autoFixable: false,
        surfaceClass: 'human-review',
      },
    })
  }

  // (d) required sections
  if (privacy) {
    for (const sectionId of missingPolicySections(policyHtml)) {
      const meta = SECTION_PATTERNS[sectionId]
      findings.push({
        verdict: SECTION_VERDICT[sectionId],
        pageUrl: privacy.pageUrl,
        severity: 'moderate',
        autoFixable: false,
        detail: `Privacy page is missing a required section: ${meta.label}.`,
        evidenceValues: {
          sectionId,
          sectionLabel: meta.label,
          privacyPageUrl: privacy.pageUrl,
          autoFixable: false,
          surfaceClass: 'human-review',
        },
      })
    }
  }

  // (e) policy names vendor not detected — informational
  if (privacy) {
    const detectedIds = new Set(inventory.vendors.map((v) => v.vendor.id))
    for (const v of vendorsNamedButNotDetected(policyHtml, detectedIds)) {
      informational.push({
        verdict: 'informational-vendor-named-not-detected',
        pageUrl: privacy.pageUrl,
        severity: 'low',
        autoFixable: false,
        detail:
          `Privacy page names ${v.displayName}, but that vendor was not detected in the crawl (may be server-side, first-party, or removed).`,
        evidenceValues: {
          vendorId: v.id,
          vendorDisplayName: v.displayName,
          informational: true,
          autoFixable: false,
        },
      })
    }
  }

  return {
    findings,
    informational,
    inventory,
    privacyPageUrl: privacy?.pageUrl ?? null,
  }
}

/** Postcondition helper for recrawl verify (findings a–d closed). */
export function privacyConsentPostconditionMet(
  result: DetectTopic72Result,
): boolean {
  const blocking = new Set<Topic72Verdict>([
    'human-review-no-privacy-page',
    'human-review-vendor-unnamed',
    'human-review-consent-missing',
    'human-review-section-missing-controller',
    'human-review-section-missing-contact',
    'human-review-section-missing-lawful-basis',
    'human-review-section-missing-recipients',
    'human-review-section-missing-international-transfers',
    'human-review-section-missing-retention',
    'human-review-section-missing-rights',
  ])
  return !result.findings.some((f) => blocking.has(f.verdict))
}
