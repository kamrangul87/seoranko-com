// src/lib/schema-validate.ts
// Product completeness gate before save: SEORANKO requires a shipped Article
// image URL and (when brand settings exist) an Organization.logo URL.
// This is a **product decision**, not a Google requirement — Google's Article
// docs state there are no required properties; `image` is recommended only.
// Distinct from schema-validator.ts's broader structural/presence checks
// (RULE 6 in article-quality-gate.ts).

export interface SchemaValidationInput {
  imageUrl: string | undefined
  organizationLogoUrl: string | undefined
  logoOmittedReason: string | undefined
  // Mirrors article-quality-gate.ts RULE 6's own suppression: a brand that's
  // never touched Settings at all has no logo by default — that's not a
  // defect worth blocking every new brand's first article on. Only a brand
  // that HAS configured brand_settings (row exists) but still has no
  // resolvable logo (not even the domain-derived Clearbit candidate) is
  // treated as a hard error here.
  hasBrandSettingsConfigured: boolean
}

export interface SchemaValidationResult {
  blocked: boolean
  reasons: string[]
}

function isAbsoluteHttpsUrl(url: string | undefined): url is string {
  return !!url && /^https:\/\/\S+/i.test(url)
}

export function assertSchemaCompleteness(input: SchemaValidationInput): SchemaValidationResult {
  const reasons: string[] = []

  if (!isAbsoluteHttpsUrl(input.imageUrl)) {
    reasons.push(
      'Article.image is missing or not a valid absolute https URL — product decision: SEORANKO requires a featured image on save (Google lists image as recommended, not required).'
    )
  }

  if (input.hasBrandSettingsConfigured && !isAbsoluteHttpsUrl(input.organizationLogoUrl)) {
    reasons.push(
      `Organization.logo is missing or not a valid absolute https URL for a brand with configured settings.` +
      (input.logoOmittedReason ? ` (${input.logoOmittedReason})` : '')
    )
  }

  return { blocked: reasons.length > 0, reasons }
}
