/**
 * Persist the selected site in the URL (?<param>=) instead of plain
 * useState, so a reload or back/forward lands on the same site instead of
 * silently falling back to the primary/first one. Used by
 * dashboard/findings and dashboard/rankings, which each pick their own
 * param name/key (site id vs. domain) but share this mechanism.
 *
 * Deliberately reads/writes window.location directly rather than
 * next/navigation's useSearchParams()/useRouter() — both call sites are
 * fully client-fetched pages with no SSR dependency on the param, and this
 * avoids requiring a Suspense-boundary restructure for a one-value cache.
 */
export function readParamFromUrl(param: string): string | null {
  if (typeof window === 'undefined') return null
  return new URLSearchParams(window.location.search).get(param)
}

export function writeParamToUrl(param: string, value: string | null): void {
  if (typeof window === 'undefined') return
  const url = new URL(window.location.href)
  if (value) url.searchParams.set(param, value)
  else url.searchParams.delete(param)
  window.history.replaceState(null, '', url.toString())
}
