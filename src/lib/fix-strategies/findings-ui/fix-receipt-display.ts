/**
 * Owner-facing Fix Receipt presentation: sitewide URL for SPA-shell strips,
 * and collapse duplicate receipts for the same fix + URL.
 */

export type ReceiptDisplayInput = {
  itemId: string
  pageUrl: string | null
  verdict?: string | null
  plainEnglish: string
  prNumber: number | null
  productionVerifiedAt: string | null
  createdAt?: string | null
}

export type DedupedReceipt<T extends ReceiptDisplayInput> = T & {
  pageUrl: string | null
  alsoPrNumbers: number[]
}

/** SPA shell strip is site-wide — never pin the receipt to a random route. */
export function receiptDisplayPageUrl(input: {
  verdict?: string | null
  pageUrl: string | null
}): string | null {
  const pageUrl = input.pageUrl
  if (!pageUrl) return null
  if (input.verdict === 'auto-strip-spa-shell-canonical') {
    try {
      return `${new URL(pageUrl).origin}/`
    } catch {
      return pageUrl
    }
  }
  return pageUrl
}

function sortKey(r: ReceiptDisplayInput): number {
  const t = r.productionVerifiedAt || r.createdAt
  if (!t) return 0
  const ms = Date.parse(t)
  return Number.isFinite(ms) ? ms : 0
}

function dedupeKey(r: ReceiptDisplayInput): string {
  const url = receiptDisplayPageUrl(r) || ''
  const title = (r.plainEnglish || r.verdict || '').trim().toLowerCase()
  return `${title}\0${url}`
}

/**
 * Keep the latest receipt per (title, display URL). Older PRs for the same
 * fix are noted as alsoPrNumbers.
 */
export function dedupeFixReceipts<T extends ReceiptDisplayInput>(
  receipts: T[],
): DedupedReceipt<T>[] {
  const groups = new Map<string, T[]>()
  for (const r of receipts) {
    const key = dedupeKey(r)
    const list = groups.get(key) ?? []
    list.push(r)
    groups.set(key, list)
  }
  const out: DedupedReceipt<T>[] = []
  for (const list of groups.values()) {
    const sorted = [...list].sort((a, b) => sortKey(b) - sortKey(a))
    const latest = sorted[0]!
    const also = sorted
      .slice(1)
      .map((r) => r.prNumber)
      .filter((n): n is number => n != null && n !== latest.prNumber)
    const uniqueAlso = Array.from(new Set(also))
    out.push({
      ...latest,
      pageUrl: receiptDisplayPageUrl(latest),
      alsoPrNumbers: uniqueAlso,
    })
  }
  return out.sort((a, b) => sortKey(b) - sortKey(a))
}
