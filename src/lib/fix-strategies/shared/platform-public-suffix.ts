/**
 * Hosting platforms whose TLS wildcards cover one label under a multi-label
 * public suffix (e.g. `*.vercel.app` matches `foo.vercel.app` but NOT
 * `www.foo.vercel.app`).
 *
 * No `tldts`/`psl` dependency in this repo — these suffixes are the
 * public-suffix-list private/platform domains named in the product brief
 * plus the common peers used for fixture/preview hosts. Prefer adding a
 * PSL library later over growing an ad-hoc TLD list.
 */

export const PLATFORM_PUBLIC_SUFFIXES = [
  'vercel.app',
  'netlify.app',
  'pages.dev',
  'github.io',
] as const

/** Strip a trailing DNS dot before comparisons. */
function bareHost(hostname: string): string {
  return hostname.toLowerCase().replace(/\.$/, '')
}

/**
 * True when `hostname` is exactly a platform public suffix or a subdomain
 * of one (e.g. `seoranko-fixture.vercel.app`).
 */
export function isPlatformPublicSuffixHost(hostname: string): boolean {
  const h = bareHost(hostname)
  if (!h) return false
  return PLATFORM_PUBLIC_SUFFIXES.some((s) => h === s || h.endsWith(`.${s}`))
}

/**
 * True when probing the www opposite of `hostname` would invent a deeper
 * subdomain under a platform public suffix (unsafe / usually unreachable).
 * Stripping a leading `www.` on a platform host is still allowed.
 */
export function shouldSkipWwwVariantProbe(hostname: string): boolean {
  const h = bareHost(hostname)
  if (!h || h.startsWith('www.')) return false
  return isPlatformPublicSuffixHost(h)
}
