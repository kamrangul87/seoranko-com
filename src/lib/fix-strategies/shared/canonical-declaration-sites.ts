/**
 * Topic 70–style resolution of where a canonical is declared in a Next.js repo.
 *
 * Declaration sites (shared facts):
 * 1. `metadata.alternates.canonical` in page.tsx
 * 2. same field in any parent layout.tsx (cascades — never write a fix here)
 * 3. `generateMetadata()` — may be conditional → indeterminate
 * 4. HTTP Link header in next.config / middleware (see header-canonical-scope)
 */

import fs from 'node:fs'
import path from 'node:path'

export type CanonicalRepoSiteKind =
  | 'page'
  | 'layout'
  | 'generateMetadata-indeterminate'
  | 'none'
  | 'unknown'

export type CanonicalRepoSite = {
  kind: CanonicalRepoSiteKind
  /** Repo-relative paths of declaring files. */
  files: string[]
  detail: string
}

const PAGE_NAMES = ['page.tsx', 'page.ts', 'page.jsx', 'page.js']
const LAYOUT_NAMES = ['layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js']

function readIfExists(file: string): string | null {
  if (!fs.existsSync(file)) return null
  try {
    return fs.readFileSync(file, 'utf8')
  } catch {
    return null
  }
}

function sourceDeclaresCanonical(source: string): boolean {
  return (
    /alternates\s*:\s*\{[^}]*canonical\s*:/s.test(source) ||
    /canonical\s*:\s*['"`]/.test(source) ||
    /canonical\s*:\s*\{/.test(source)
  )
}

function hasGenerateMetadataCanonical(source: string): boolean {
  const hasGen =
    /export\s+(async\s+)?function\s+generateMetadata/.test(source) ||
    /export\s+const\s+generateMetadata/.test(source)
  if (!hasGen) return false
  return /canonical\s*:/.test(source)
}

function layoutChainFiles(routeFile: string, appDir: string): string[] {
  const files: string[] = []
  let dir = path.dirname(routeFile)
  const appRoot = path.resolve(appDir)

  while (true) {
    for (const name of LAYOUT_NAMES) {
      const candidate = path.join(dir, name)
      if (fs.existsSync(candidate)) files.push(candidate)
    }
    if (path.resolve(dir) === appRoot) break
    const parent = path.dirname(dir)
    if (parent === dir) break
    if (!path.resolve(parent).startsWith(appRoot)) break
    dir = parent
  }
  return files
}

/**
 * Resolve canonical declaration sites for a route file under `appDir`.
 */
export function resolveCanonicalRepoSites(
  routeFile: string,
  appDir: string,
  repoRoot?: string,
): CanonicalRepoSite {
  const root = repoRoot ?? path.dirname(appDir)
  const rel = (abs: string) => path.relative(root, abs).replace(/\\/g, '/')

  const pageSource = readIfExists(routeFile)
  if (pageSource && hasGenerateMetadataCanonical(pageSource)) {
    return {
      kind: 'generateMetadata-indeterminate',
      files: [rel(routeFile)],
      detail:
        'generateMetadata sets canonical — runtime-dependent (indeterminate)',
    }
  }

  const files: string[] = []
  let pageDeclares = false
  if (pageSource && sourceDeclaresCanonical(pageSource)) {
    pageDeclares = true
    files.push(rel(routeFile))
  }

  const layoutHits: string[] = []
  for (const layout of layoutChainFiles(routeFile, appDir)) {
    const source = readIfExists(layout)
    if (!source) continue
    if (hasGenerateMetadataCanonical(source)) {
      return {
        kind: 'generateMetadata-indeterminate',
        files: [rel(layout)],
        detail:
          'layout generateMetadata sets canonical — runtime-dependent',
      }
    }
    if (sourceDeclaresCanonical(source)) {
      layoutHits.push(rel(layout))
    }
  }

  if (layoutHits.length > 0) {
    return {
      kind: 'layout',
      files: [...files, ...layoutHits],
      detail: `canonical declared in layout (cascades to children): ${layoutHits.join(', ')}`,
    }
  }

  if (pageDeclares) {
    return {
      kind: 'page',
      files,
      detail: `canonical declared in page file: ${files[0]}`,
    }
  }

  if (!pageSource && !fs.existsSync(routeFile)) {
    return {
      kind: 'unknown',
      files: [],
      detail: 'route file not found — declaration site unknown',
    }
  }

  return {
    kind: 'none',
    files: [],
    detail: 'no canonical declaration in page or layout chain',
  }
}

/**
 * Find every file under appDir that declares a canonical (for topic 17
 * multi-site reporting). Prefer reporting both page and layout when both fire.
 */
export function findAllCanonicalDeclarationFiles(
  routeFile: string,
  appDir: string,
  repoRoot?: string,
): string[] {
  const site = resolveCanonicalRepoSites(routeFile, appDir, repoRoot)
  return site.files
}

/**
 * Resolve `app/.../page.tsx` for a URL path under appDir when it exists.
 */
export function resolvePageFileForPath(
  urlPath: string,
  appDir: string,
): string | null {
  let pathname = urlPath
  try {
    pathname = new URL(urlPath, 'https://example.invalid').pathname
  } catch {
    // treat as path
  }
  const cleaned = pathname.replace(/\/$/, '') || ''
  const dir = cleaned === '' ? appDir : path.join(appDir, cleaned.replace(/^\//, ''))
  for (const name of PAGE_NAMES) {
    const candidate = path.join(dir, name)
    if (fs.existsSync(candidate)) return candidate
  }
  // Also try the path itself if it ends with page.*
  if (PAGE_NAMES.some((n) => dir.endsWith(n)) && fs.existsSync(dir)) return dir
  return null
}
