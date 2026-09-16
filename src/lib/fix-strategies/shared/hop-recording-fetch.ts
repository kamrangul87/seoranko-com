export type RedirectHop = {
  url: string
  status: number
  location: string | null
}

export type HopRecordingResult = {
  hops: RedirectHop[]
  finalUrl: string
  finalStatus: number
  stoppedReason: 'non-3xx' | 'repeat-url' | 'max-hops'
}

export type HopRecordingDeps = {
  fetch: typeof fetch
}

export type HopRecordingOptions = {
  /** Maximum 3xx hops to follow. Default 10 (Googlebot hard limit). */
  maxHops?: number
}

function resolveLocation(currentUrl: string, location: string): string {
  return new URL(location, currentUrl).href
}

function isRedirectStatus(status: number): boolean {
  return status >= 300 && status < 400
}

/**
 * GET a URL with `redirect: 'manual'`, recording every hop's status and
 * Location until a non-3xx response, a repeat URL (loop), or maxHops.
 */
export async function recordRedirectHops(
  url: string,
  deps: HopRecordingDeps,
  opts?: HopRecordingOptions,
): Promise<HopRecordingResult> {
  const maxHops = opts?.maxHops ?? 10
  const hops: RedirectHop[] = []
  const visited = new Set<string>()

  let currentUrl = url
  let finalUrl = url
  let finalStatus = 0
  let stoppedReason: HopRecordingResult['stoppedReason'] = 'non-3xx'

  while (true) {
    if (visited.has(currentUrl)) {
      stoppedReason = 'repeat-url'
      finalUrl = currentUrl
      break
    }
    visited.add(currentUrl)

    const response = await deps.fetch(currentUrl, {
      method: 'GET',
      redirect: 'manual',
    })

    const rawLocation = response.headers.get('location')
    const location =
      rawLocation !== null && rawLocation !== ''
        ? resolveLocation(currentUrl, rawLocation)
        : null

    hops.push({
      url: currentUrl,
      status: response.status,
      location,
    })

    finalUrl = currentUrl
    finalStatus = response.status

    if (!isRedirectStatus(response.status) || location === null) {
      stoppedReason = 'non-3xx'
      break
    }

    if (visited.has(location)) {
      stoppedReason = 'repeat-url'
      break
    }

    if (hops.length >= maxHops) {
      stoppedReason = 'max-hops'
      break
    }

    currentUrl = location
  }

  return { hops, finalUrl, finalStatus, stoppedReason }
}
