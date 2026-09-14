import fs from 'node:fs'
import path from 'node:path'

export type RouteKind =
  | 'static-route'
  | 'dynamic-route'
  | 'no-route'
  | 'indeterminate'

export type ResolvePathResult = {
  kind: RouteKind
  /** Absolute path to the matched page file, when known. */
  routeFile: string | null
}

/** String tri-state so callers can switch without boolean confusion. */
export type NoindexDeclaration = 'true' | 'false' | 'indeterminate'

type Segment =
  | { type: 'static'; value: string }
  | { type: 'param'; name: string }
  | { type: 'catch-all'; name: string }
  | { type: 'optional-catch-all'; name: string }

type RoutePattern = {
  file: string
  segments: Segment[]
  specificity: number
}

const PAGE_NAMES = new Set(['page.tsx', 'page.ts', 'page.jsx', 'page.js'])

const LAYOUT_NAMES = ['layout.tsx', 'layout.ts', 'layout.jsx', 'layout.js']

function isRouteGroup(name: string): boolean {
  return name.startsWith('(') && name.endsWith(')')
}

function isParallelSlot(name: string): boolean {
  return name.startsWith('@')
}

function parseSegment(name: string): Segment | null {
  if (isRouteGroup(name) || isParallelSlot(name)) return null
  const optionalCatch = name.match(/^\[\[\.\.\.(.+)\]\]$/)
  if (optionalCatch) {
    return { type: 'optional-catch-all', name: optionalCatch[1]! }
  }
  const catchAll = name.match(/^\[\.\.\.(.+)\]$/)
  if (catchAll) return { type: 'catch-all', name: catchAll[1]! }
  const param = name.match(/^\[(.+)\]$/)
  if (param) return { type: 'param', name: param[1]! }
  return { type: 'static', value: name }
}

function specificity(segments: Segment[]): number {
  let score = 0
  for (const seg of segments) {
    if (seg.type === 'static') score += 1000
    else if (seg.type === 'param') score += 100
    else if (seg.type === 'catch-all') score += 10
    else score += 1
  }
  score += segments.length
  return score
}

function walkPages(
  dir: string,
  urlSegments: Segment[],
  out: RoutePattern[],
): void {
  if (!fs.existsSync(dir)) return
  const entries = fs.readdirSync(dir, { withFileTypes: true })

  for (const entry of entries) {
    if (entry.name.startsWith('.')) continue
    const full = path.join(dir, entry.name)
    if (entry.isFile() && PAGE_NAMES.has(entry.name)) {
      out.push({
        file: full,
        segments: urlSegments,
        specificity: specificity(urlSegments),
      })
      continue
    }
    if (!entry.isDirectory()) continue
    if (isParallelSlot(entry.name)) continue
    if (isRouteGroup(entry.name)) {
      walkPages(full, urlSegments, out)
      continue
    }
    const seg = parseSegment(entry.name)
    if (!seg) continue
    walkPages(full, [...urlSegments, seg], out)
  }
}

function normalizeUrlPath(urlPath: string): string[] {
  const trimmed = urlPath.split('?')[0]!.split('#')[0]!
  return trimmed
    .replace(/^\/+/, '')
    .replace(/\/+$/, '')
    .split('/')
    .filter(Boolean)
}

function matchSegments(pattern: Segment[], pathSegs: string[]): boolean {
  let i = 0
  let j = 0
  while (i < pattern.length) {
    const seg = pattern[i]!
    if (seg.type === 'static') {
      if (j >= pathSegs.length || pathSegs[j] !== seg.value) return false
      i++
      j++
      continue
    }
    if (seg.type === 'param') {
      if (j >= pathSegs.length) return false
      i++
      j++
      continue
    }
    if (seg.type === 'catch-all') {
      // Requires ≥1 remaining segment — does NOT match the parent root.
      if (j >= pathSegs.length) return false
      return true
    }
    // optional-catch-all: zero or more remaining segments, including parent root.
    return true
  }
  return j === pathSegs.length
}

/**
 * Middleware probe keyed on rewrite() calls, not file presence.
 *
 * Autodun middleware answer (2026-09-14): real Autodun / SEORANKO middleware
 * uses next()/redirect/headers only — no rewrite(). Presence of middleware.ts
 * alone must not mark paths indeterminate. When a rewrite *does* exist,
 * treat paths as indeterminate rather than guessing matcher scope.
 */
export function middlewareMayRewrite(appDir: string): boolean {
  const root = path.dirname(appDir)
  const candidates = [
    path.join(root, 'middleware.ts'),
    path.join(root, 'middleware.js'),
  ]
  for (const file of candidates) {
    if (!fs.existsSync(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    if (
      /\.rewrite\s*\(/.test(source) ||
      /NextResponse\.rewrite\s*\(/.test(source)
    ) {
      return true
    }
  }
  return false
}

/**
 * Resolve a URL path against an App Router `app/` directory.
 */
export function resolvePath(appDir: string, urlPath: string): ResolvePathResult {
  if (middlewareMayRewrite(appDir)) {
    return { kind: 'indeterminate', routeFile: null }
  }

  const pathSegs = normalizeUrlPath(urlPath)
  const patterns: RoutePattern[] = []
  walkPages(appDir, [], patterns)
  patterns.sort((a, b) => b.specificity - a.specificity)

  for (const pattern of patterns) {
    if (!matchSegments(pattern.segments, pathSegs)) continue
    const dynamic = pattern.segments.some((s) => s.type !== 'static')
    return {
      kind: dynamic ? 'dynamic-route' : 'static-route',
      routeFile: pattern.file,
    }
  }

  return { kind: 'no-route', routeFile: null }
}

function readIfExists(file: string): string | null {
  if (!fs.existsSync(file)) return null
  return fs.readFileSync(file, 'utf8')
}

/**
 * Inspect a module source for a noindex declaration.
 */
export function inspectNoindexSource(source: string): NoindexDeclaration {
  const hasGenerateMetadata =
    /export\s+(async\s+)?function\s+generateMetadata/.test(source) ||
    /export\s+const\s+generateMetadata/.test(source)

  if (hasGenerateMetadata && /robots\s*:/.test(source)) {
    // Runtime-dependent — do not guess which branch runs.
    return 'indeterminate'
  }

  if (
    /robots\s*:\s*\{\s*index\s*:\s*false/.test(source) ||
    /robots\s*:\s*['"]noindex['"]/.test(source) ||
    /robots\s*:\s*\{[^}]*\bindex\s*:\s*false/.test(source)
  ) {
    return 'true'
  }

  return 'false'
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
 * Whether the repo declares noindex for the resolved route file.
 * Checks page metadata, every layout above it, and generateMetadata.
 */
export function declaresNoindex(
  routeFile: string,
  appDir: string,
): NoindexDeclaration {
  const pageSource = readIfExists(routeFile)
  if (pageSource) {
    const pageResult = inspectNoindexSource(pageSource)
    if (pageResult === 'true' || pageResult === 'indeterminate') return pageResult
  }

  for (const layout of layoutChainFiles(routeFile, appDir)) {
    const source = readIfExists(layout)
    if (!source) continue
    const result = inspectNoindexSource(source)
    if (result === 'true' || result === 'indeterminate') return result
  }

  return 'false'
}
