/**
 * Shared Quality Gate / schema logo policy.
 *
 * FINAL ARTIFACT INVARIANT (enforced by article-v2 finalize order):
 * Publishing, saving, UI streaming, and final Quality Gate scoring must all
 * use the same canonical finalized HTML. Intermediate snapshots must not
 * determine the persisted quality result or schema score.
 *
 * Logo requirement (product rule, single source):
 * - require: brand_settings row exists AND logo_url is set
 * - omit: otherwise (Clearbit may still be emitted by the generator as a
 *   candidate URL, but QG must not treat logo as required)
 *
 * Wired into article-v2, article-quality-recheck, and article-fix-all.
 * runQualityGate / validateSchema default to omit (false) when the flag is
 * not passed — never silently require a logo the brand never configured.
 */

export type LogoPolicyMode = 'require' | 'omit'

export interface BrandSettingsLike {
  configured: boolean
  logoUrl: string | null
}

export interface LogoPolicy {
  mode: LogoPolicyMode
  /** Absolute https logo URL when known (brand_settings.logo_url). */
  logoUrl?: string
  reason: string
}

export interface ResolveLogoPolicyInput {
  brandSettings: BrandSettingsLike
}

/**
 * Whether the Quality Gate / schema-validator should require Organization
 * and publisher.logo. Mirrors today's article-v2 `!!brandSettings.logoUrl`.
 */
export function resolveLogoPolicy(input: ResolveLogoPolicyInput): LogoPolicy {
  const url = input.brandSettings.logoUrl?.trim() || ''
  if (url) {
    return {
      mode: 'require',
      logoUrl: url,
      reason: 'brand_settings.logo_url is configured',
    }
  }
  if (input.brandSettings.configured) {
    return {
      mode: 'omit',
      reason: 'brand_settings row exists but logo_url is empty — logo not required in QG',
    }
  }
  return {
    mode: 'omit',
    reason: 'no brand_settings logo_url — logo not required in QG',
  }
}

/** Maps policy → validateSchema / runQualityGate expectOrganizationLogo flag. */
export function expectOrganizationLogoFromPolicy(policy: LogoPolicy): boolean {
  return policy.mode === 'require'
}

/**
 * Default severity for dated-policy findings that need verification
 * (UNSUPPORTED / NEEDS_REVIEW / PARTIALLY_SUPPORTED).
 *
 * Contradicted / outdated current claims use critical via
 * `severityForFreshnessFinding` in freshness-policy.ts — never invent a
 * different severity in a caller for the same claim.
 */
export const DATED_POLICY_SEVERITY = 'warning' as const

/**
 * Repeated uncited grant/financial figures (e.g. "up to £350" twice):
 * one document-level GOV.UK citation (or one verify hedge that satisfies
 * binding) clears the figure for the whole article. Each restatement does
 * not need its own nearby citation. Autofix may still hedge every instance
 * for visible consistency; scoring emits one issue per unique figure.
 */
export const GRANT_FIGURE_CITATION_POLICY = 'document-level-once' as const
