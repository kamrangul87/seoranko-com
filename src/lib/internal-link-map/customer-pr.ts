export type CustomerPrState = {
  state: 'open' | 'closed'
  merged: boolean
  mergedAt?: string | null
}

export type CustomerPrClass = 'open' | 'merged' | 'closed_unmerged' | 'unknown'

export function parseGithubPullUrl(
  url: string | null | undefined,
): { owner: string; repo: string; prNumber: number } | null {
  if (!url) return null
  const m = url.trim().match(
    /^https?:\/\/(?:www\.)?github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)(?:\/)?(?:[?#].*)?$/i,
  )
  if (!m) return null
  const owner = m[1]
  const repo = m[2]
  const n = Number(m[3])
  if (!owner || !repo || !Number.isFinite(n) || n <= 0) return null
  return { owner, repo, prNumber: n }
}

export function classifyCustomerPr(
  pr: CustomerPrState | null | undefined,
): CustomerPrClass {
  if (!pr) return 'unknown'
  if (pr.merged) return 'merged'
  if (pr.state === 'closed') return 'closed_unmerged'
  return 'open'
}
