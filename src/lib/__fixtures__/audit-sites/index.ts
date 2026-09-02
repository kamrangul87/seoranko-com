import { canonicalAndRedirects } from './canonical-and-redirects/manifest'
import { brokenLinksAndOrphans } from './broken-links-and-orphans/manifest'
import { duplicateContent } from './duplicate-content/manifest'
import { jsRenderedSpa } from './js-rendered-spa/manifest'
import type { FixtureManifest } from './types'

export const ALL_FIXTURE_MANIFESTS: FixtureManifest[] = [
  canonicalAndRedirects,
  brokenLinksAndOrphans,
  duplicateContent,
  jsRenderedSpa,
]

export function getFixtureManifest(id: string): FixtureManifest {
  const m = ALL_FIXTURE_MANIFESTS.find((f) => f.id === id)
  if (!m) throw new Error(`Unknown fixture: ${id}`)
  return m
}

export {
  canonicalAndRedirects,
  brokenLinksAndOrphans,
  duplicateContent,
  jsRenderedSpa,
}
