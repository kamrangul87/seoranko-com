/**
 * After the owner sets jurisdiction, resolve the jurisdiction-not-set finding.
 * Does not assemble or write any legal/privacy wording.
 */

import { JURISDICTION_NOT_SET_VERDICT } from './jurisdiction'

export type JurisdictionFindingRow = {
  id: string
  verdict: string
  status: string
}

export function findingsResolvedByJurisdiction(
  findings: JurisdictionFindingRow[],
  jurisdiction: string | null,
): string[] {
  if (!jurisdiction) return []
  return findings
    .filter(
      (f) =>
        f.verdict === JURISDICTION_NOT_SET_VERDICT &&
        (f.status === 'open' || f.status === 'regressed'),
    )
    .map((f) => f.id)
}
