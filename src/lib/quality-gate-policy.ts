/**
 * Shared Quality Gate / schema logo policy.
 *
 * FINAL ARTIFACT INVARIANT (enforced by article-v2 finalize order):
 * Publishing, saving, UI streaming, and final Quality Gate scoring must all
 * use the same canonical finalized HTML. Intermediate snapshots must not
 * determine the persisted quality result or schema score.
 *
 * Logo requirement (product rule, single source — use everywhere):
 * - require: brand_settings.logo_url is set, OR forceRequire audit mode
 * - omit: otherwise
 *
 * Domain / organization URL existence alone must NEVER flip the gate into
 * logo-required mode. Clearbit may still be emitted by the generator as a
 * candidate URL; under omit, QG must not warn on missing logo.
 *
 * Wired into: article-v2, article-quality-recheck, article-fix-all,
 * article-improve, improve-article (via article-improver).
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
  /**
   * Explicit audit / force-require mode — when true, require logo even if
   * brand_settings.logo_url is empty. Never inferred from domain/URL alone.
   */
  forceRequire?: boolean
}

/**
 * Whether the Quality Gate / schema-validator should require Organization
 * and publisher.logo. Single resolver for every runQualityGate caller.
 */
export function resolveLogoPolicy(input: ResolveLogoPolicyInput): LogoPolicy {
  if (input.forceRequire) {
    const url = input.brandSettings.logoUrl?.trim() || undefined
    return {
      mode: 'require',
      logoUrl: url,
      reason: 'forceRequire audit mode — Organization/publisher logo required',
    }
  }

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

/** Convenience for spreading into runQualityGate / validateSchema options. */
export function logoGateOptions(policy: LogoPolicy): { expectOrganizationLogo: boolean } {
  return { expectOrganizationLogo: expectOrganizationLogoFromPolicy(policy) }
}

/**
 * Single severity for every dated-policy finding across article-v2,
 * runQualityGate, recheck, and Fix All.
 *
 * warning (not critical): surfaces in Fix All "needs human review", affects
 * readyToPublish / score, but does not hard-stop the generation pipeline.
 * Never use a different severity in a caller — import this constant.
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
