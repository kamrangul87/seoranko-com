/**
 * Static guard: supabase-js `data` must not be treated as an empty success
 * without checking `error` in the same destructure.
 *
 * Scans API routes + cron + verification/freshness libs — the surfaces where
 * this bug class has shipped as `{ success: true, sent: 0 }` / verified.
 */
import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const ROOT = path.join(__dirname, '..', '..')

const SCAN_DIRS = [
  'src/app/api/cron',
  'src/lib/freshness-automation.ts',
  'src/lib/drift-tracker.ts',
  'src/lib/rank-monitor-pass.ts',
  'src/lib/publisher-verification-runner.ts',
  'src/lib/publish-verification.ts',
  'src/app/api/cannibalization/route.ts',
  'src/app/api/topical-map/route.ts',
  'src/app/api/geo-audit/route.ts',
  'src/app/api/publish/verify/route.ts',
]

const ASSIGN =
  /const\s*\{\s*([^}]*\bdata\b[^}]*)\}\s*=\s*await\s+/g

function walk(target: string): string[] {
  const abs = path.join(ROOT, target)
  if (!fs.existsSync(abs)) return []
  const st = fs.statSync(abs)
  if (st.isFile()) return abs.endsWith('.ts') || abs.endsWith('.tsx') ? [abs] : []
  const out: string[] = []
  for (const ent of fs.readdirSync(abs, { withFileTypes: true })) {
    if (ent.name.endsWith('.test.ts') || ent.name.endsWith('.test.tsx')) continue
    out.push(...walk(path.join(target, ent.name)))
  }
  return out
}

function looksLikeEmptySuccess(after: string): boolean {
  return (
    /!\w+\?\.length/.test(after) ||
    /success:\s*true/.test(after) ||
    /processed:\s*0/.test(after) ||
    /No tracked articles/.test(after) ||
    /result:\s*null/.test(after)
  )
}

describe('supabase-js results must check error before empty-success', () => {
  it('flags data-only destructure followed by empty/success handling', () => {
    const files = SCAN_DIRS.flatMap(walk)
    expect(files.length).toBeGreaterThan(5)

    const violations: string[] = []
    for (const file of files) {
      const text = fs.readFileSync(file, 'utf8')
      const lines = text.split('\n')
      let m: RegExpExecArray | null
      const re = new RegExp(ASSIGN.source, 'g')
      while ((m = re.exec(text))) {
        const keys = m[1] || ''
        if (/\berror\b/.test(keys)) continue
        const idx = m.index
        const line = text.slice(0, idx).split('\n').length
        // require .from( nearby (supabase query, not unrelated await)
        const window = text.slice(idx, idx + 400)
        if (!/\.from\s*\(/.test(window)) continue
        const after = lines.slice(line, line + 25).join('\n')
        if (!looksLikeEmptySuccess(after)) continue
        const rel = path.relative(ROOT, file)
        // Retired weekly email cron (see docs/RETIRED_WEEKLY_EMAIL_DIGEST.md).
        if (rel.includes('send-digests')) continue
        violations.push(`${rel}:${line}`)
      }
    }

    expect(violations, violations.join('\n')).toEqual([])
  })
})
