/**
 * Near-duplicate detection via word shingles + Jaccard similarity.
 * Main content region excludes nav/header/footer/aside/script/style.
 */

const BOILERPLATE_RE =
  /<(nav|header|footer|aside)\b[\s\S]*?<\/\1>/gi

export function extractMainContentText(html: string): string {
  let body = html
    .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
    .replace(BOILERPLATE_RE, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()

  if (body.length < 40) {
    // SPA shells — fall back to title + meta description as weak fingerprint
    const title = html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1]?.trim().toLowerCase() || ''
    const meta =
      html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1]?.trim().toLowerCase() ||
      ''
    body = `${title} ${meta}`.trim()
  }

  return body
}

function shingles(text: string, size = 5): Set<string> {
  const words = text.split(/\s+/).filter((w) => w.length > 1)
  const set = new Set<string>()
  if (words.length < size) {
    if (words.length > 0) set.add(words.join(' '))
    return set
  }
  for (let i = 0; i <= words.length - size; i++) {
    set.add(words.slice(i, i + size).join(' '))
  }
  return set
}

export function jaccardSimilarity(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1
  if (a.size === 0 || b.size === 0) return 0
  let inter = 0
  for (const x of a) if (b.has(x)) inter++
  const union = a.size + b.size - inter
  return union === 0 ? 0 : inter / union
}

/** Fixed similarity threshold — cluster when Jaccard >= 0.85 */
export const NEAR_DUPLICATE_THRESHOLD = 0.85

export function fingerprintShingles(text: string): Set<string> {
  return shingles(text)
}

export function contentFingerprintHash(text: string): string {
  const s = shingles(text)
  const sample = Array.from(s).sort().slice(0, 12).join('|')
  let h = 0
  for (let i = 0; i < sample.length; i++) h = (h * 31 + sample.charCodeAt(i)) >>> 0
  return `fp-${h.toString(16)}`
}

export interface DuplicateCluster {
  clusterId: string
  memberUrls: string[]
  similarityEvidence: string
}

/**
 * Greedy clustering — assign each URL to first cluster with similarity >= threshold.
 */
export function clusterNearDuplicates(
  pages: Array<{ url: string; mainText: string }>,
  threshold = NEAR_DUPLICATE_THRESHOLD,
): Map<string, DuplicateCluster> {
  const shinglesByUrl = new Map<string, Set<string>>()
  for (const p of pages) {
    shinglesByUrl.set(p.url, fingerprintShingles(p.mainText))
  }

  const clusters: DuplicateCluster[] = []
  const urlToCluster = new Map<string, DuplicateCluster>()

  for (const p of pages) {
    const sh = shinglesByUrl.get(p.url)!
    let placed = false
    for (const cluster of clusters) {
      const rep = shinglesByUrl.get(cluster.memberUrls[0]!)!
      const sim = jaccardSimilarity(sh, rep)
      if (sim >= threshold) {
        cluster.memberUrls.push(p.url)
        urlToCluster.set(p.url, cluster)
        cluster.similarityEvidence = `Jaccard ${sim.toFixed(3)} >= ${threshold} vs cluster rep ${cluster.memberUrls[0]}`
        placed = true
        break
      }
    }
    if (!placed) {
      const id = `dup-${clusters.length + 1}`
      const cluster: DuplicateCluster = {
        clusterId: id,
        memberUrls: [p.url],
        similarityEvidence: `New cluster (no prior match >= ${threshold})`,
      }
      clusters.push(cluster)
      urlToCluster.set(p.url, cluster)
    }
  }

  // Only keep clusters with 2+ members as duplicate clusters
  for (const [url, cluster] of urlToCluster) {
    if (cluster.memberUrls.length < 2) {
      urlToCluster.delete(url)
    }
  }

  return urlToCluster
}
