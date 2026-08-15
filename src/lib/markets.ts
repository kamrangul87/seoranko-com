// Single source of truth for target markets / DataForSEO location codes.
// Used by Pipeline, Research, Write, and API routes.

export interface Market {
  value: string
  label: string
  locationCode: number
  languageCode?: string
}

/** DataForSEO location codes for major global markets (sorted by label after Global). */
export const MARKETS: Market[] = [
  { value: 'Global', label: 'Global', locationCode: 2840 },
  { value: 'AE', label: 'United Arab Emirates', locationCode: 2784 },
  { value: 'AR', label: 'Argentina', locationCode: 2032 },
  { value: 'AT', label: 'Austria', locationCode: 2040 },
  { value: 'AU', label: 'Australia', locationCode: 2036 },
  { value: 'BE', label: 'Belgium', locationCode: 2056 },
  { value: 'BR', label: 'Brazil', locationCode: 2076 },
  { value: 'CA', label: 'Canada', locationCode: 2124 },
  { value: 'CH', label: 'Switzerland', locationCode: 2756 },
  { value: 'CL', label: 'Chile', locationCode: 2152 },
  { value: 'CO', label: 'Colombia', locationCode: 2170 },
  { value: 'CZ', label: 'Czech Republic', locationCode: 2203 },
  { value: 'DE', label: 'Germany', locationCode: 2276, languageCode: 'de' },
  { value: 'DK', label: 'Denmark', locationCode: 2208 },
  { value: 'EG', label: 'Egypt', locationCode: 2818 },
  { value: 'ES', label: 'Spain', locationCode: 2724 },
  { value: 'FI', label: 'Finland', locationCode: 2246 },
  { value: 'FR', label: 'France', locationCode: 2250, languageCode: 'fr' },
  { value: 'GR', label: 'Greece', locationCode: 2300 },
  { value: 'HK', label: 'Hong Kong', locationCode: 2344 },
  { value: 'HU', label: 'Hungary', locationCode: 2348 },
  { value: 'ID', label: 'Indonesia', locationCode: 2360 },
  { value: 'IE', label: 'Ireland', locationCode: 2372 },
  { value: 'IL', label: 'Israel', locationCode: 2376 },
  { value: 'IN', label: 'India', locationCode: 2356 },
  { value: 'IT', label: 'Italy', locationCode: 2380 },
  { value: 'JP', label: 'Japan', locationCode: 2392 },
  { value: 'KR', label: 'South Korea', locationCode: 2410 },
  { value: 'MX', label: 'Mexico', locationCode: 2484 },
  { value: 'MY', label: 'Malaysia', locationCode: 2458 },
  { value: 'NG', label: 'Nigeria', locationCode: 2566 },
  { value: 'NL', label: 'Netherlands', locationCode: 2528 },
  { value: 'NO', label: 'Norway', locationCode: 2578 },
  { value: 'NZ', label: 'New Zealand', locationCode: 2554 },
  { value: 'PH', label: 'Philippines', locationCode: 2608 },
  { value: 'PK', label: 'Pakistan', locationCode: 2586 },
  { value: 'PL', label: 'Poland', locationCode: 2616 },
  { value: 'PT', label: 'Portugal', locationCode: 2620 },
  { value: 'RO', label: 'Romania', locationCode: 2642 },
  { value: 'SA', label: 'Saudi Arabia', locationCode: 2682 },
  { value: 'SE', label: 'Sweden', locationCode: 2752 },
  { value: 'SG', label: 'Singapore', locationCode: 2702 },
  { value: 'TH', label: 'Thailand', locationCode: 2764 },
  { value: 'TR', label: 'Turkey', locationCode: 2792 },
  { value: 'TW', label: 'Taiwan', locationCode: 2158 },
  { value: 'UK', label: 'United Kingdom', locationCode: 2826 },
  { value: 'US', label: 'United States', locationCode: 2840 },
  { value: 'VN', label: 'Vietnam', locationCode: 2704 },
  { value: 'ZA', label: 'South Africa', locationCode: 2710 },
]

export const DEFAULT_MARKET = 'Global'

const marketByValue = new Map(MARKETS.map(m => [m.value, m]))

export function getMarket(value: string): Market | undefined {
  return marketByValue.get(value)
}

export function locationCodeFor(value: string): number {
  return getMarket(value)?.locationCode ?? 2840
}

export function languageCodeFor(value: string): string {
  return getMarket(value)?.languageCode ?? 'en'
}

export function marketLabel(value: string): string {
  return getMarket(value)?.label ?? value
}

/** Map short codes (UK, US) to authority-guidance keys (united kingdom, united states). */
const AUTHORITY_MARKET_ALIASES: Record<string, string> = {
  global: 'global',
  uk: 'united kingdom',
  us: 'united states',
  au: 'australia',
  ca: 'canada',
  de: 'germany',
  fr: 'france',
  in: 'india',
  ae: 'united arab emirates',
  sa: 'saudi arabia',
  sg: 'singapore',
  za: 'south africa',
  pk: 'pakistan',
  ie: 'ireland',
  nz: 'new zealand',
  ng: 'nigeria',
}

export function normalizeMarketForAuthority(market: string): string {
  const key = market.trim().toLowerCase()
  if (AUTHORITY_MARKET_ALIASES[key]) return AUTHORITY_MARKET_ALIASES[key]
  const byLabel = MARKETS.find(m => m.label.toLowerCase() === key)
  if (byLabel) return AUTHORITY_MARKET_ALIASES[byLabel.value.toLowerCase()] ?? key
  return key
}

/** Build rank-tracker LOCATION_CODES entries from MARKETS (for dataforseo.ts sync). */
export function marketsToLocationCodes(): Record<string, { code: number; name: string; flag: string }> {
  const out: Record<string, { code: number; name: string; flag: string }> = {}
  for (const m of MARKETS) {
    out[m.value.toLowerCase()] = { code: m.locationCode, name: m.label, flag: '🌍' }
  }
  out.global = { code: 2840, name: 'Global', flag: '🌍' }
  return out
}

export const WRITE_MARKET_STORAGE_KEY = 'seoranko_write_market'
