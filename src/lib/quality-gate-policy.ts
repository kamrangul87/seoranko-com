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
 * article-improve (via buildQualityGateRunOptions / resolveLogoPolicy).
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
 * one supporting citation (or verify hedge) covers every restatement of the
 * SAME figure — the link need not be repeated after each sentence.
 *
 * A citation that supports figure A does NOT clear figure B. Binding is
 * claim-level (see `src/lib/claim-evidence.ts`), not "any official URL in
 * the document proves every claim."
 */
export const GRANT_FIGURE_CITATION_POLICY = 'claim-level-once' as const
