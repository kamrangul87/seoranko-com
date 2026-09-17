/**
 * Parse docs/fix-strategies/_sources.md for citations used by a dossier.
 */

import fs from 'node:fs'
import path from 'node:path'
import type { SourceCitation } from './types'

let cachedRows: SourceCitationRow[] | null = null

type SourceCitationRow = SourceCitation & { usedBy: string[] }

function sourcesPath(): string {
  return path.join(process.cwd(), 'docs/fix-strategies/_sources.md')
}

function parseSourcesMarkdown(md: string): SourceCitationRow[] {
  const rows: SourceCitationRow[] = []
  for (const line of md.split('\n')) {
    if (!line.startsWith('|')) continue
    const cells = line.split('|').map((c) => c.trim())
    // | # | Source | Section | Requirement | Date verified | Used by |
    if (cells.length < 7) continue
    const idRaw = cells[1]
    if (!idRaw || idRaw === '#' || !/^\d+$/.test(idRaw)) continue
    const source = cells[2] ?? ''
    const section = cells[3] ?? ''
    const requirement = cells[4] ?? ''
    const verifiedOn = cells[5] ?? ''
    const usedByRaw = cells[6] ?? ''
    const usedBy = usedByRaw
      .split(',')
      .map((s) => s.trim().replace(/\.md$/, ''))
      .filter(Boolean)
    rows.push({
      sourceId: Number(idRaw),
      url: source === '—' || source === '-' ? null : source,
      section,
      requirement,
      verifiedOn,
      usedBy,
    })
  }
  return rows
}

export function loadSourceRows(): SourceCitationRow[] {
  if (cachedRows) return cachedRows
  try {
    const md = fs.readFileSync(sourcesPath(), 'utf8')
    cachedRows = parseSourcesMarkdown(md)
  } catch {
    cachedRows = []
  }
  return cachedRows
}

/** Primary citations for a dossier slug (without .md). Cap at a few for UI. */
export function sourcesForDossier(
  dossierSlug: string | null,
  limit = 3,
): SourceCitation[] {
  if (!dossierSlug) return []
  const rows = loadSourceRows().filter((r) =>
    r.usedBy.some(
      (u) => u === dossierSlug || u.endsWith(`/${dossierSlug}`),
    ),
  )
  // Prefer rows with real URLs
  const sorted = [...rows].sort((a, b) => {
    if (a.url && !b.url) return -1
    if (!a.url && b.url) return 1
    return a.sourceId - b.sourceId
  })
  return sorted.slice(0, limit).map(({ usedBy: _u, ...rest }) => rest)
}

/** Test helper — inject parsed rows without reading disk. */
export function _setSourceRowsForTest(rows: SourceCitationRow[] | null): void {
  cachedRows = rows
}
