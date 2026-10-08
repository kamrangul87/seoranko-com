/**
 * Production preview resolution must never hardcode fixture hosts.
 * Per-finding verify uses wait-vercel-deploy; one-run must reuse that path.
 */

import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { isPlaceholderPreviewUrl } from './github-ops'

const SRC_ROOT = join(process.cwd(), 'src')

const FIXTURE_HOST_RE =
  /preview\.example\.com|https?:\/\/(?:[\w-]+\.)?example\.com\/pr-|fixture\.example/i

/** Test / fixture / story files may use example hosts; production modules may not. */
function isExemptPath(rel: string): boolean {
  const base = rel.replace(/\\/g, '/')
  if (/\.(test|spec)\.(ts|tsx|js|jsx)$/.test(base)) return true
  if (base.includes('/__fixtures__/') || base.includes('/__mocks__/')) return true
  if (base.includes('/fixtures/')) return true
  // Fixture GitHub ops may use a dedicated test preview host.
  if (base.endsWith('/fix-run/fixture-github.ts')) return true
  // Detector that *recognises* placeholder hosts (not a resolution source).
  if (base.endsWith('/fix-run/github-ops.ts')) return true
  return false
}

function walkTsFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === '.next') continue
      walkTsFiles(full, out)
    } else if (/\.(ts|tsx)$/.test(name)) {
      out.push(full)
    }
  }
  return out
}

describe('preview URL production guard', () => {
  it('isPlaceholderPreviewUrl catches fixture hosts', () => {
    expect(isPlaceholderPreviewUrl('https://preview.example.com/pr-1')).toBe(
      true,
    )
    expect(isPlaceholderPreviewUrl('https://seoranko-fixture.vercel.app')).toBe(
      false,
    )
    expect(isPlaceholderPreviewUrl(null)).toBe(false)
  })

  it('no production module under src/ hardcodes example.com for preview resolution', () => {
    const offenders: Array<{ file: string; line: number; text: string }> = []
    for (const abs of walkTsFiles(SRC_ROOT)) {
      const rel = relative(process.cwd(), abs)
      if (isExemptPath(rel)) continue
      const text = readFileSync(abs, 'utf8')
      const lines = text.split(/\r?\n/)
      lines.forEach((line, i) => {
        if (!FIXTURE_HOST_RE.test(line)) return
        // Allow comments that document the ban.
        if (
          /^\s*(\/\/|\*|\/\*)/.test(line) &&
          /never|ban|refuse|placeholder/i.test(line)
        ) {
          return
        }
        offenders.push({ file: rel, line: i + 1, text: line.trim() })
      })
    }
    // Specifically: tick.ts must not invent preview.example.com anymore.
    expect(
      offenders.filter((o) => o.file.includes('/fix-run/tick.ts')),
    ).toEqual([])
    expect(offenders).toEqual([])
  })
})
