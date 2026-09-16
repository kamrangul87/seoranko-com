/**
 * Resolve where an HTTP Link canonical header is declared in the repo
 * (topic 16 / topic 70).
 *
 * - next.config headers() / headers array → may cover many routes
 * - middleware setting Link → often indeterminate (matcher scope)
 */

import fs from 'node:fs'
import path from 'node:path'

export type HeaderCanonicalScope =
  | {
      kind: 'single-route'
      file: string
      detail: string
    }
  | {
      kind: 'multi-route'
      file: string
      detail: string
    }
  | {
      kind: 'indeterminate'
      file: string | null
      detail: string
    }
  | {
      kind: 'not-found'
      file: null
      detail: string
    }

function walkFiles(dir: string, out: string[], depth = 0): void {
  if (depth > 6 || !fs.existsSync(dir)) return
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) {
      walkFiles(full, out, depth + 1)
      continue
    }
    if (/^(next\.config\.(js|mjs|cjs|ts)|middleware\.(ts|js))$/.test(entry.name)) {
      out.push(full)
    }
  }
}

function sourceDeclaresCanonicalLink(source: string): boolean {
  return (
    /rel\s*[:=]\s*['"]canonical['"]/i.test(source) ||
    /rel=canonical/i.test(source) ||
    (/Link\b/.test(source) && /canonical/i.test(source))
  )
}

/**
 * Inspect the repo for where a Link: rel=canonical header is produced.
 */
export function resolveHeaderCanonicalScope(
  repoRoot: string,
): HeaderCanonicalScope {
  const roots = [repoRoot, path.join(repoRoot, 'src')]
  const files: string[] = []
  for (const r of roots) walkFiles(r, files)

  const hits = files.filter((f) => {
    try {
      return sourceDeclaresCanonicalLink(fs.readFileSync(f, 'utf8'))
    } catch {
      return false
    }
  })

  if (hits.length === 0) {
    // Also scan next.config* at root explicitly
    return {
      kind: 'not-found',
      file: null,
      detail:
        'No next.config/middleware Link canonical declaration found — scope indeterminate',
    }
  }

  const rel = (abs: string) => path.relative(repoRoot, abs).replace(/\\/g, '/')

  for (const hit of hits) {
    const name = path.basename(hit)
    const source = fs.readFileSync(hit, 'utf8')
    const file = rel(hit)

    if (/^middleware\./.test(name)) {
      return {
        kind: 'indeterminate',
        file,
        detail: `Link canonical set in middleware (${file}) — matcher scope not statically resolved (topic 70)`,
      }
    }

    // next.config — headers() often uses source: '/:path*' or similar
    if (/source\s*:\s*['"]\/:path/.test(source) || /source\s*:\s*['"]\/\*/.test(source)) {
      return {
        kind: 'multi-route',
        file,
        detail: `Link canonical in ${file} matches many routes — removing changes every covered page`,
      }
    }

    // Single explicit path source
    const pathMatch = source.match(/source\s*:\s*['"](\/[^'"]+)['"]/)
    if (pathMatch && !pathMatch[1]!.includes(':') && !pathMatch[1]!.includes('*')) {
      return {
        kind: 'single-route',
        file,
        detail: `Link canonical in ${file} scoped to ${pathMatch[1]}`,
      }
    }

    return {
      kind: 'indeterminate',
      file,
      detail: `Link canonical in ${file} — route matcher not statically resolvable`,
    }
  }

  return {
    kind: 'indeterminate',
    file: null,
    detail: 'Header canonical source found but scope unresolved',
  }
}
