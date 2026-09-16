import {
  declaresNoindex,
  inspectNoindexSource,
  type NoindexDeclaration,
} from '../site-model'

export type { NoindexDeclaration }
export { declaresNoindex, inspectNoindexSource }

/**
 * Whether the Next.js route (page + layout chain) declares `noindex` in repo
 * source — not injected HTML.
 *
 * - `'true'` — static metadata (or layout cascade) sets robots noindex
 * - `'false'` — no noindex declaration found
 * - `'indeterminate'` — `generateMetadata` sets robots (runtime-dependent)
 */
export function checkRepoDeclaredNoindex(
  routeFile: string,
  appDir: string,
): NoindexDeclaration {
  return declaresNoindex(routeFile, appDir)
}
