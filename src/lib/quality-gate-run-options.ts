/**
 * Shared Quality Gate run options — Generate / Recheck / Improve / Fix All
 * must resolve logo (and related) policy the same way.
 */

import {
  expectOrganizationLogoFromPolicy,
  resolveLogoPolicy,
  type BrandSettingsLike,
} from '@/lib/quality-gate-policy'

export type QualityGateCaller = 'generate' | 'recheck' | 'improve' | 'fix-all'

export interface BuildQualityGateRunOptionsInput {
  brand: string
  keyword: string
  authorName?: string
  registeredLinkDomains?: string[]
  minWordCount?: number
  maxWordCount?: number
  maxTypically?: number
  brandSettings?: BrandSettingsLike
  /** Explicit override — when omitted, derived from brandSettings via shared policy. */
  expectOrganizationLogo?: boolean
  caller?: QualityGateCaller
}

/**
 * Canonical options object for `runQualityGate`.
 * Logo expectation always comes from `resolveLogoPolicy` unless explicitly overridden.
 */
export function buildQualityGateRunOptions(input: BuildQualityGateRunOptionsInput) {
  const brandSettings = input.brandSettings ?? { configured: false, logoUrl: null }
  const logoPolicy = resolveLogoPolicy({ brandSettings })
  const expectOrganizationLogo =
    typeof input.expectOrganizationLogo === 'boolean'
      ? input.expectOrganizationLogo
      : expectOrganizationLogoFromPolicy(logoPolicy)

  return {
    brand: input.brand,
    keyword: input.keyword,
    authorName: input.authorName,
    registeredLinkDomains: input.registeredLinkDomains ?? [],
    minWordCount: input.minWordCount,
    maxWordCount: input.maxWordCount,
    maxTypically: input.maxTypically,
    expectOrganizationLogo,
    logoPolicy,
    caller: input.caller,
  }
}

/** All production callers must use the same logo derivation. */
export const QUALITY_GATE_CALLERS: QualityGateCaller[] = [
  'generate',
  'recheck',
  'improve',
  'fix-all',
]
