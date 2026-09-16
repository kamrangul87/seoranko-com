/**
 * Topic 42 / topic 70 — resolve where an href is declared in the repo.
 *
 * Shared nav / layout / header / footer → one finding naming that component.
 * Page-local body links → the page file.
 */

import fs from 'node:fs'
import path from 'node:path'

export type DeclarationKind = 'shared-nav' | 'page' | 'unknown'

export type HrefDeclaration = {
  kind: DeclarationKind
  /** Repo-relative path of the declaring file, when known. */
  file: string | null
  detail: string
}

const SHARED_NAME_RE =
  /(^|\/)(layout|template|nav|navbar|navigation|header|footer|site-header|site-footer|main-nav)(\.|\/)|(^|\/)[^/]*(nav|header|footer|layout)[^/]*\.(tsx|ts|jsx|js)$/i

function walkSourceFiles(dir: string, out: string[]): void {
  if (!fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === '.next') continue
      walkSourceFiles(full, out)
      continue
    }
    if (/\.(tsx|ts|jsx|js)$/.test(entry.name)) out.push(full)
  }
}

function hrefSearchTokens(href: string): string[] {
  const tokens = new Set<string>([href])
  try {
    const u = new URL(href, 'https://example.invalid')
    tokens.add(u.pathname + u.search)
    tokens.add(u.pathname)
  } catch {
    // keep raw
  }
  return Array.from(tokens).filter((t) => t.length > 0)
}

/**
 * Find the declaration site for an href under `repoRoot`.
 * Prefers shared nav/layout matches over page files.
 */
export function resolveHrefDeclaration(
  repoRoot: string,
  href: string,
): HrefDeclaration {
  const searchRoots = ['src/app', 'app', 'src/components', 'components', 'src'].map(
    (rel) => path.join(repoRoot, rel),
  )

  const files: string[] = []
  for (const root of searchRoots) {
    if (fs.existsSync(root)) walkSourceFiles(root, files)
  }

  const tokens = hrefSearchTokens(href)
  const hits: string[] = []

  for (const file of files) {
    let source: string
    try {
      source = fs.readFileSync(file, 'utf8')
    } catch {
      continue
    }
    if (tokens.some((t) => source.includes(t))) {
      hits.push(file)
    }
  }

  if (hits.length === 0) {
    return {
      kind: 'unknown',
      file: null,
      detail: 'href not found in repo source — declaration site unknown',
    }
  }

  const rel = (abs: string) => path.relative(repoRoot, abs).replace(/\\/g, '/')

  const shared = hits.find((f) => SHARED_NAME_RE.test(rel(f)))
  if (shared) {
    return {
      kind: 'shared-nav',
      file: rel(shared),
      detail: `declared in shared navigation/layout: ${rel(shared)}`,
    }
  }

  // Prefer a page.tsx hit if present
  const page = hits.find((f) => /\/page\.(tsx|ts|jsx|js)$/.test(rel(f)))
  if (page) {
    return {
      kind: 'page',
      file: rel(page),
      detail: `declared in page file: ${rel(page)}`,
    }
  }

  return {
    kind: 'page',
    file: rel(hits[0]!),
    detail: `declared in ${rel(hits[0]!)}`,
  }
}
