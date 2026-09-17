/**
 * Topic 47 — dated ISO catalogues for Google hreflang validation.
 *
 * Google accepts ISO 639-1 + ISO 3166-1 Alpha-2 + ISO 15924, MINUS exclusions
 * (es-419, reserved regions EU/UN/UK). This is NOT BCP 47 (topic 34).
 *
 * Every catalogue carries verifiedOn. Undated snapshots must not drive findings.
 * Human source: docs/fix-strategies/_hreflang_iso_code_tables.md
 */

export type HreflangIsoSnapshotMeta = {
  /** ISO date YYYY-MM-DD — required for findings. */
  verifiedOn: string
  iso6391Authority: string
  iso3166Authority: string
  iso15924Authority: string
  googleExclusionsAuthority: string
}

/** Snapshot metadata. Empty verifiedOn → validators must not raise. */
export const HREFLANG_ISO_SNAPSHOT_META: HreflangIsoSnapshotMeta = {
  verifiedOn: '2026-09-16',
  iso6391Authority: 'https://www.iso.org/iso-639-language-codes.html',
  iso3166Authority: 'https://www.iso.org/iso-3166-country-codes.html',
  iso15924Authority: 'https://www.unicode.org/iso15924/iso15924-codes.html',
  googleExclusionsAuthority:
    'https://developers.google.com/search/docs/specialty/international/localized-versions',
}

/** Full ISO 639-1 Alpha-2 language set (dated snapshot). */
export const ISO_639_1_CODES: ReadonlySet<string> = new Set(
  [
  "aa",
  "ab",
  "ae",
  "af",
  "ak",
  "am",
  "an",
  "ar",
  "as",
  "av",
  "ay",
  "az",
  "ba",
  "be",
  "bg",
  "bh",
  "bi",
  "bm",
  "bn",
  "bo",
  "br",
  "bs",
  "ca",
  "ce",
  "ch",
  "co",
  "cr",
  "cs",
  "cu",
  "cv",
  "cy",
  "da",
  "de",
  "dv",
  "dz",
  "ee",
  "el",
  "en",
  "eo",
  "es",
  "et",
  "eu",
  "fa",
  "ff",
  "fi",
  "fj",
  "fo",
  "fr",
  "fy",
  "ga",
  "gd",
  "gl",
  "gn",
  "gu",
  "gv",
  "ha",
  "he",
  "hi",
  "ho",
  "hr",
  "ht",
  "hu",
  "hy",
  "hz",
  "ia",
  "id",
  "ie",
  "ig",
  "ii",
  "ik",
  "io",
  "is",
  "it",
  "iu",
  "ja",
  "jv",
  "ka",
  "kg",
  "ki",
  "kj",
  "kk",
  "kl",
  "km",
  "kn",
  "ko",
  "kr",
  "ks",
  "ku",
  "kv",
  "kw",
  "ky",
  "la",
  "lb",
  "lg",
  "li",
  "ln",
  "lo",
  "lt",
  "lu",
  "lv",
  "mg",
  "mh",
  "mi",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "mt",
  "my",
  "na",
  "nb",
  "nd",
  "ne",
  "ng",
  "nl",
  "nn",
  "no",
  "nr",
  "nv",
  "ny",
  "oc",
  "oj",
  "om",
  "or",
  "os",
  "pa",
  "pi",
  "pl",
  "ps",
  "pt",
  "qu",
  "rm",
  "rn",
  "ro",
  "ru",
  "rw",
  "sa",
  "sc",
  "sd",
  "se",
  "sg",
  "si",
  "sk",
  "sl",
  "sm",
  "sn",
  "so",
  "sq",
  "sr",
  "ss",
  "st",
  "su",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "ti",
  "tk",
  "tl",
  "tn",
  "to",
  "tr",
  "ts",
  "tt",
  "tw",
  "ty",
  "ug",
  "uk",
  "ur",
  "uz",
  "ve",
  "vi",
  "vo",
  "wa",
  "wo",
  "xh",
  "yi",
  "yo",
  "za",
  "zh",
  "zu"
].map((c) => c.toLowerCase()),
)

/** Full ISO 3166-1 Alpha-2 region set (dated snapshot). */
export const ISO_3166_1_ALPHA2_CODES: ReadonlySet<string> = new Set(
  [
  "AD",
  "AE",
  "AF",
  "AG",
  "AI",
  "AL",
  "AM",
  "AO",
  "AQ",
  "AR",
  "AS",
  "AT",
  "AU",
  "AW",
  "AX",
  "AZ",
  "BA",
  "BB",
  "BD",
  "BE",
  "BF",
  "BG",
  "BH",
  "BI",
  "BJ",
  "BL",
  "BM",
  "BN",
  "BO",
  "BQ",
  "BR",
  "BS",
  "BT",
  "BV",
  "BW",
  "BY",
  "BZ",
  "CA",
  "CC",
  "CD",
  "CF",
  "CG",
  "CH",
  "CI",
  "CK",
  "CL",
  "CM",
  "CN",
  "CO",
  "CR",
  "CU",
  "CV",
  "CW",
  "CX",
  "CY",
  "CZ",
  "DE",
  "DJ",
  "DK",
  "DM",
  "DO",
  "DZ",
  "EC",
  "EE",
  "EG",
  "EH",
  "ER",
  "ES",
  "ET",
  "FI",
  "FJ",
  "FK",
  "FM",
  "FO",
  "FR",
  "GA",
  "GB",
  "GD",
  "GE",
  "GF",
  "GG",
  "GH",
  "GI",
  "GL",
  "GM",
  "GN",
  "GP",
  "GQ",
  "GR",
  "GS",
  "GT",
  "GU",
  "GW",
  "GY",
  "HK",
  "HM",
  "HN",
  "HR",
  "HT",
  "HU",
  "ID",
  "IE",
  "IL",
  "IM",
  "IN",
  "IO",
  "IQ",
  "IR",
  "IS",
  "IT",
  "JE",
  "JM",
  "JO",
  "JP",
  "KE",
  "KG",
  "KH",
  "KI",
  "KM",
  "KN",
  "KP",
  "KR",
  "KW",
  "KY",
  "KZ",
  "LA",
  "LB",
  "LC",
  "LI",
  "LK",
  "LR",
  "LS",
  "LT",
  "LU",
  "LV",
  "LY",
  "MA",
  "MC",
  "MD",
  "ME",
  "MF",
  "MG",
  "MH",
  "MK",
  "ML",
  "MM",
  "MN",
  "MO",
  "MP",
  "MQ",
  "MR",
  "MS",
  "MT",
  "MU",
  "MV",
  "MW",
  "MX",
  "MY",
  "MZ",
  "NA",
  "NC",
  "NE",
  "NF",
  "NG",
  "NI",
  "NL",
  "NO",
  "NP",
  "NR",
  "NU",
  "NZ",
  "OM",
  "PA",
  "PE",
  "PF",
  "PG",
  "PH",
  "PK",
  "PL",
  "PM",
  "PN",
  "PR",
  "PS",
  "PT",
  "PW",
  "PY",
  "QA",
  "RE",
  "RO",
  "RS",
  "RU",
  "RW",
  "SA",
  "SB",
  "SC",
  "SD",
  "SE",
  "SG",
  "SH",
  "SI",
  "SJ",
  "SK",
  "SL",
  "SM",
  "SN",
  "SO",
  "SR",
  "SS",
  "ST",
  "SV",
  "SX",
  "SY",
  "SZ",
  "TC",
  "TD",
  "TF",
  "TG",
  "TH",
  "TJ",
  "TK",
  "TL",
  "TM",
  "TN",
  "TO",
  "TR",
  "TT",
  "TV",
  "TW",
  "TZ",
  "UA",
  "UG",
  "UM",
  "US",
  "UY",
  "UZ",
  "VA",
  "VC",
  "VE",
  "VG",
  "VI",
  "VN",
  "VU",
  "WF",
  "WS",
  "YE",
  "YT",
  "ZA",
  "ZM",
  "ZW"
].map((c) => c.toUpperCase()),
)

/**
 * ISO 15924 script codes present in the dated Google-relevant snapshot.
 * Other ISO 15924 codes remain valid once added to a dated full snapshot;
 * do not invent a deny-list.
 */
export const ISO_15924_SCRIPT_CODES: ReadonlySet<string> = new Set(
  ["Hans","Hant","Latn","Cyrl","Arab"],
)

/** Google exclusions — each carries its own verifiedOn. */
export type GoogleHreflangExclusion = {
  pattern: string
  kind: 'full-tag' | 'region'
  treatment: string
  verifiedOn: string
  autoFixTo?: string
}

export const GOOGLE_HREFLANG_EXCLUSIONS: readonly GoogleHreflangExclusion[] = [
  {
    pattern: 'es-419',
    kind: 'full-tag',
    treatment: 'unsupported by Google despite valid BCP 47 (G15)',
    verifiedOn: '2026-09-16',
  },
  {
    pattern: 'EU',
    kind: 'region',
    treatment: 'reserved; Google ignores that portion (G14)',
    verifiedOn: '2026-09-16',
  },
  {
    pattern: 'UN',
    kind: 'region',
    treatment: 'reserved; Google ignores that portion (G14)',
    verifiedOn: '2026-09-16',
  },
  {
    pattern: 'UK',
    kind: 'region',
    treatment: 'reserved; use GB (en-UK → en-GB) (G13, G14)',
    verifiedOn: '2026-09-16',
    autoFixTo: 'GB',
  },
] as const

export function isoTablesAreDated(
  meta: HreflangIsoSnapshotMeta = HREFLANG_ISO_SNAPSHOT_META,
): boolean {
  return typeof meta.verifiedOn === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(meta.verifiedOn)
}

export type HreflangCodeOk = {
  ok: true
  kind:
    | 'x-default'
    | 'language'
    | 'language-script'
    | 'language-region'
    | 'language-script-region'
  /** Convention form: language lowercase, script title-case, region UPPER. */
  normalized: string
  /** True when only case differed from convention. */
  caseConventionIssue: boolean
}

export type HreflangCodeFail = {
  ok: false
  reason:
    | 'undated-tables'
    | 'empty'
    | 'region-only'
    | 'invalid-language'
    | 'invalid-region'
    | 'invalid-script'
    | 'reserved-region'
    | 'es-419'
    | 'inverted-order'
    | 'malformed'
    | 'x-default-with-language'
  detail: string
  /** Deterministic replacement when known. */
  autoFixTo: string | null
  autoFixable: boolean
}

export type HreflangCodeValidation = HreflangCodeOk | HreflangCodeFail

function titleCaseScript(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase()
}

function isScriptCode(sub: string): boolean {
  return ISO_15924_SCRIPT_CODES.has(titleCaseScript(sub))
}

function isRegionCode(sub: string): boolean {
  return ISO_3166_1_ALPHA2_CODES.has(sub.toUpperCase())
}

function isLanguageCode(sub: string): boolean {
  return ISO_639_1_CODES.has(sub.toLowerCase())
}

function reservedRegion(sub: string): GoogleHreflangExclusion | null {
  const up = sub.toUpperCase()
  for (const ex of GOOGLE_HREFLANG_EXCLUSIONS) {
    if (ex.kind === 'region' && ex.pattern === up && ex.verifiedOn) return ex
  }
  return null
}

/**
 * Validate one hreflang value against Google's composed rule (not BCP 47).
 */
export function validateGoogleHreflangCode(
  raw: string,
  meta: HreflangIsoSnapshotMeta = HREFLANG_ISO_SNAPSHOT_META,
): HreflangCodeValidation {
  if (!isoTablesAreDated(meta)) {
    return {
      ok: false,
      reason: 'undated-tables',
      detail: 'ISO snapshot has no verifiedOn — cannot support a finding',
      autoFixTo: null,
      autoFixable: false,
    }
  }

  const trimmed = raw.trim()
  if (!trimmed) {
    return {
      ok: false,
      reason: 'empty',
      detail: 'Empty hreflang value',
      autoFixTo: null,
      autoFixable: false,
    }
  }

  const lower = trimmed.toLowerCase()

  // x-default literal (G17, G20)
  if (lower === 'x-default') {
    return {
      ok: true,
      kind: 'x-default',
      normalized: 'x-default',
      caseConventionIssue: trimmed !== 'x-default',
    }
  }

  // x-default with accompanying language code (G20) — e.g. x-default-en
  if (lower.startsWith('x-default-') || lower.startsWith('x-default ')) {
    return {
      ok: false,
      reason: 'x-default-with-language',
      detail: `x-default needs no accompanying language code (G20): "${trimmed}"`,
      autoFixTo: 'x-default',
      autoFixable: true,
    }
  }

  // Explicit Google full-tag exclusion
  for (const ex of GOOGLE_HREFLANG_EXCLUSIONS) {
    if (ex.kind === 'full-tag' && ex.verifiedOn && lower === ex.pattern.toLowerCase()) {
      return {
        ok: false,
        reason: 'es-419',
        detail: ex.treatment,
        autoFixTo: null,
        autoFixable: false,
      }
    }
  }

  const parts = trimmed.split('-').filter((p) => p.length > 0)
  if (parts.length === 0 || parts.length > 3) {
    return {
      ok: false,
      reason: 'malformed',
      detail: `Malformed hreflang "${trimmed}"`,
      autoFixTo: null,
      autoFixable: false,
    }
  }

  // Inverted order: REGION-language (e.g. US-en)
  if (
    parts.length === 2 &&
    isRegionCode(parts[0]!) &&
    isLanguageCode(parts[1]!) &&
    !isLanguageCode(parts[0]!)
  ) {
    const fixed = `${parts[1]!.toLowerCase()}-${parts[0]!.toUpperCase()}`
    return {
      ok: false,
      reason: 'inverted-order',
      detail: `Inverted subtag order "${trimmed}" → "${fixed}" (G9)`,
      autoFixTo: fixed,
      autoFixable: true,
    }
  }

  // Region alone (G12)
  if (parts.length === 1 && isRegionCode(parts[0]!) && !isLanguageCode(parts[0]!)) {
    return {
      ok: false,
      reason: 'region-only',
      detail: `Region without language "${trimmed}" is invalid (G12)`,
      autoFixTo: null,
      autoFixable: false,
    }
  }

  const lang = parts[0]!
  if (!isLanguageCode(lang)) {
    return {
      ok: false,
      reason: 'invalid-language',
      detail: `Language subtag "${lang}" is not ISO 639-1 (G10)`,
      autoFixTo: null,
      autoFixable: false,
    }
  }

  if (parts.length === 1) {
    const normalized = lang.toLowerCase()
    return {
      ok: true,
      kind: 'language',
      normalized,
      caseConventionIssue: trimmed !== normalized,
    }
  }

  if (parts.length === 2) {
    const second = parts[1]!
    if (isScriptCode(second)) {
      const normalized = `${lang.toLowerCase()}-${titleCaseScript(second)}`
      return {
        ok: true,
        kind: 'language-script',
        normalized,
        caseConventionIssue: trimmed !== normalized,
      }
    }
    const reserved = reservedRegion(second)
    if (reserved) {
      const fixRegion = reserved.autoFixTo ?? null
      const autoFixTo =
        fixRegion != null ? `${lang.toLowerCase()}-${fixRegion}` : null
      return {
        ok: false,
        reason: 'reserved-region',
        detail: `Reserved region "${second.toUpperCase()}": ${reserved.treatment}`,
        autoFixTo,
        autoFixable: autoFixTo != null,
      }
    }
    if (!isRegionCode(second)) {
      return {
        ok: false,
        reason: 'invalid-region',
        detail: `Region "${second}" is not ISO 3166-1 Alpha-2 (G11)`,
        autoFixTo: null,
        autoFixable: false,
      }
    }
    const normalized = `${lang.toLowerCase()}-${second.toUpperCase()}`
    return {
      ok: true,
      kind: 'language-region',
      normalized,
      caseConventionIssue: trimmed !== normalized,
    }
  }

  // language-script-region (zh-Hans-US)
  const script = parts[1]!
  const region = parts[2]!
  if (!isScriptCode(script)) {
    return {
      ok: false,
      reason: 'invalid-script',
      detail: `Script "${script}" is not in the dated ISO 15924 snapshot (G16)`,
      autoFixTo: null,
      autoFixable: false,
    }
  }
  const reserved = reservedRegion(region)
  if (reserved) {
    const fixRegion = reserved.autoFixTo ?? null
    const autoFixTo =
      fixRegion != null
        ? `${lang.toLowerCase()}-${titleCaseScript(script)}-${fixRegion}`
        : null
    return {
      ok: false,
      reason: 'reserved-region',
      detail: `Reserved region "${region.toUpperCase()}": ${reserved.treatment}`,
      autoFixTo,
      autoFixable: autoFixTo != null,
    }
  }
  if (!isRegionCode(region)) {
    return {
      ok: false,
      reason: 'invalid-region',
      detail: `Region "${region}" is not ISO 3166-1 Alpha-2 (G11)`,
      autoFixTo: null,
      autoFixable: false,
    }
  }
  const normalized = `${lang.toLowerCase()}-${titleCaseScript(script)}-${region.toUpperCase()}`
  return {
    ok: true,
    kind: 'language-script-region',
    normalized,
    caseConventionIssue: trimmed !== normalized,
  }
}
