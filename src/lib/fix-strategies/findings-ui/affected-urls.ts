/**
 * Resolve every affected page URL for a rolled-up (or multi-URL) finding.
 * Prefer evidenceValues.memberUrls; never invent a single representative.
 */
export function affectedUrlsForFinding(f: {
  pageUrl?: string | null
  affectedUrlCount?: number
  rolledUp?: boolean
  evidenceValues?: { memberUrls?: string[] | null } | null
}): string[] {
  const fromEvidence = f.evidenceValues?.memberUrls
  if (Array.isArray(fromEvidence) && fromEvidence.length > 0) {
    return Array.from(new Set(fromEvidence.filter((u) => typeof u === 'string' && u)))
  }
  if (f.pageUrl) return [f.pageUrl]
  return []
}
