/**
 * Auto-merge gates + blast-radius + outcome record formatting.
 */

import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest'
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  assessSingleFileBlastRadius,
  isBlockedAutoMergePath,
} from './blast-radius'
import { evaluateAutoMergeVerdictGate } from './auto-merge'
import {
  appendOutcomeRecordLocal,
  formatOutcomeEntry,
  nextOutcomeIndex,
} from './outcome-record'
import {
  useMemoryFixFlowStore,
  resetMemoryFixFlowStore,
  _idleForTests,
} from './persist'
import { maybeAutoMergeAfterPreviewVerify } from './auto-merge'

describe('blast-radius', () => {
  it('allows a single content HTML file', () => {
    const r = assessSingleFileBlastRadius([
      'public/blog/mot-advisories-explained-uk.html',
    ])
    expect(r.ok).toBe(true)
  })

  it('blocks multi-file PRs', () => {
    const r = assessSingleFileBlastRadius(['a.html', 'b.html'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.reason).toMatch(/single-file/)
  })

  it('blocks site-wide config and shared layouts', () => {
    for (const p of [
      'vercel.json',
      'next.config.mjs',
      'public/robots.txt',
      'app/sitemap.ts',
      'app/layout.tsx',
      'middleware.ts',
      'components/SiteLayout.tsx',
    ]) {
      expect(isBlockedAutoMergePath(p), p).toBe(true)
    }
  })
})

describe('evaluateAutoMergeVerdictGate', () => {
  it('allows auto-fixable only', () => {
    expect(
      evaluateAutoMergeVerdictGate({
        surfaceClass: 'auto-fixable',
        autoFixable: true,
        reportOnly: false,
        verdict: 'auto-set-dimensions',
      }).allowed,
    ).toBe(true)
  })

  it('refuses human-review and report-only', () => {
    expect(
      evaluateAutoMergeVerdictGate({
        surfaceClass: 'human-review',
        autoFixable: false,
        reportOnly: false,
        verdict: 'human-review-no-height-auto',
      }).allowed,
    ).toBe(false)
    expect(
      evaluateAutoMergeVerdictGate({
        surfaceClass: 'report-only',
        autoFixable: false,
        reportOnly: true,
        verdict: 'report-omission',
      }).allowed,
    ).toBe(false)
  })
})

describe('outcome record', () => {
  it('formats auto_merged true/false', () => {
    const md = formatOutcomeEntry(
      {
        origin: 'https://autodun.com',
        topicId: '49',
        verdict: 'auto-set-dimensions',
        pageUrl: 'https://autodun.com/blog/x.html',
        detectedAt: '2026-09-21T00:00:00.000Z',
        fixedAt: '2026-09-22T00:00:00.000Z',
        prUrl: 'https://github.com/o/r/pull/1',
        prNumber: 1,
        autoMerged: true,
        productionVerify: 'OK',
        productionVerifyDetail: 'ok',
        productionVerifiedAt: '2026-09-22T01:00:00.000Z',
        outcome: 'closed',
      },
      2,
    )
    expect(md).toMatch(/auto_merged \| \*\*true\*\*/)
    expect(nextOutcomeIndex('## 1. foo\n## 2. bar\n')).toBe(3)
  })

  it('appends to a local ledger file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'outcome-'))
    const path = join(dir, 'docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md')
    mkdirSync(join(dir, 'docs/fix-strategies'), { recursive: true })
    writeFileSync(
      path,
      '# Fix → verify → outcome record\n\n## 1. prior\n',
      'utf8',
    )
    const r = appendOutcomeRecordLocal(
      {
        origin: 'https://example.com',
        topicId: '49',
        verdict: 'auto-set-dimensions',
        pageUrl: 'https://example.com/a.html',
        detectedAt: 't0',
        fixedAt: 't1',
        prUrl: 'https://github.com/o/r/pull/9',
        prNumber: 9,
        autoMerged: true,
        productionVerify: 'OK',
        productionVerifyDetail: 'ok',
        productionVerifiedAt: 't2',
        outcome: 'closed',
      },
      dir,
    )
    expect(r.ok).toBe(true)
    const body = readFileSync(path, 'utf8')
    expect(body).toMatch(/## 2\./)
    expect(body).toMatch(/auto_merged \| \*\*true\*\*/)
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('maybeAutoMergeAfterPreviewVerify', () => {
  beforeEach(() => {
    resetMemoryFixFlowStore()
    useMemoryFixFlowStore()
  })
  afterEach(() => {
    resetMemoryFixFlowStore()
    vi.unstubAllGlobals()
  })

  it('does not merge when auto_merge_enabled is OFF', async () => {
    const preview = {
      ..._idleForTests('f-off', 'u1'),
      step: 'verified' as const,
      verifyOk: true,
      verifyDetail: 'Topic 49 live verify OK',
      prNumber: 42,
      prUrl: 'https://github.com/o/r/pull/42',
      commitDetail: 'committed',
    }
    const out = await maybeAutoMergeAfterPreviewVerify({
      findingId: 'f-off',
      userId: 'u1',
      finding: {
        id: 'f-off',
        siteId: null,
        topicId: '49',
        kind: 'performance/img-missing-dimensions',
        verdict: 'auto-set-dimensions',
        surfaceClass: 'auto-fixable',
        autoFixable: true,
        reportOnly: false,
        pageUrl: 'https://example.com/blog/x.html',
        bucket: 'actionable',
        severity: 'moderate',
        rollupKey: 'k',
        declarationSite: null,
        affectedUrlCount: 1,
        detail: 'd',
        proposedDiff: null,
        evidenceValues: null,
        sourceRows: [],
        firstSeenRunId: null,
        lastSeenRunId: null,
        firstSeenAt: '2026-09-21T00:00:00.000Z',
        lastSeenAt: '2026-09-21T00:00:00.000Z',
        userId: 'u1',
      },
      creds: {
        owner: 'o',
        repo: 'r',
        accessToken: 't',
        baseBranch: 'main',
      },
      previewState: preview,
      productionUrl: 'https://example.com/blog/x.html',
      autoMergeEnabledOverride: false,
    })
    expect(out.autoMerged).toBe(false)
    expect(out.autoMergeBlockedReason).toMatch(/OFF/)
  })

  it('merges when all gates hold, then records production OK', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'outcome-am-'))
    mkdirSync(join(dir, 'docs/fix-strategies'), { recursive: true })
    writeFileSync(
      join(dir, 'docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md'),
      '# Fix → verify → outcome record\n\n',
      'utf8',
    )
    const cwd = process.cwd()
    process.chdir(dir)

    const fetchImpl = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url)
      const method = (init?.method || 'GET').toUpperCase()
      if (u.includes('/pulls/7') && !u.includes('/files') && !u.includes('/merge') && method === 'GET') {
        return json({
          head: { sha: 'abc123' },
          merge_commit_sha: 'merge999',
          number: 7,
          html_url: 'https://github.com/o/r/pull/7',
        })
      }
      if (u.includes('/pulls/7/files')) {
        return json([{ filename: 'public/blog/x.html' }])
      }
      if (u.includes('/commits/abc123/status')) {
        return json({
          state: 'success',
          statuses: [{ context: 'ci', state: 'success' }],
        })
      }
      if (u.includes('/commits/abc123/check-runs')) {
        return json({ check_runs: [] })
      }
      if (u.includes('/pulls/7/merge') && method === 'PUT') {
        return json({ sha: 'merge999', merged: true })
      }
      if (u.includes('example.com/blog/x.html')) {
        // Minimal page with matching dims so topic 49 verify can pass if images mocked —
        // verifyFindingLive for topic 49 fetches images; return empty imgs page → ok (no imgs).
        return new Response('<html><body><h1>ok</h1></body></html>', {
          status: 200,
          headers: { 'content-type': 'text/html' },
        })
      }
      return new Response(`unexpected ${method} ${u}`, { status: 500 })
    }) as unknown as typeof fetch

    const preview = {
      ..._idleForTests('f-on', 'u1'),
      step: 'verified' as const,
      verifyOk: true,
      verifyDetail: 'Topic 49 live verify OK (url=https://preview/x)',
      prNumber: 7,
      prUrl: 'https://github.com/o/r/pull/7',
      commitDetail: 'set dims',
      committedAt: '2026-09-22T00:00:00.000Z',
    }

    const out = await maybeAutoMergeAfterPreviewVerify({
      findingId: 'f-on',
      userId: 'u1',
      finding: {
        id: 'f-on',
        siteId: null,
        topicId: '49',
        kind: 'performance/img-missing-dimensions',
        verdict: 'auto-set-dimensions',
        surfaceClass: 'auto-fixable',
        autoFixable: true,
        reportOnly: false,
        pageUrl: 'https://example.com/blog/x.html',
        bucket: 'actionable',
        severity: 'moderate',
        rollupKey: 'k',
        declarationSite: null,
        affectedUrlCount: 1,
        detail: 'd',
        proposedDiff: null,
        evidenceValues: null,
        sourceRows: [],
        firstSeenRunId: null,
        lastSeenRunId: null,
        firstSeenAt: '2026-09-21T00:00:00.000Z',
        lastSeenAt: '2026-09-21T00:00:00.000Z',
        userId: 'u1',
      },
      creds: {
        owner: 'o',
        repo: 'r',
        accessToken: 't',
        baseBranch: 'main',
      },
      previewState: preview,
      productionUrl: 'https://example.com/blog/x.html',
      autoMergeEnabledOverride: true,
      ciTimeoutMs: 5_000,
      productionTimeoutMs: 5_000,
      fetchImpl,
    })

    process.chdir(cwd)
    expect(out.autoMerged).toBe(true)
    expect(out.productionVerifyOk).toBe(true)
    expect(out.mergeSha).toBe('merge999')
    expect(out.needsHumanAttention).toBe(false)
    const ledger = readFileSync(
      join(dir, 'docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md'),
      'utf8',
    )
    expect(ledger).toMatch(/auto_merged \| \*\*true\*\*/)
    rmSync(dir, { recursive: true, force: true })
  })

  it('blocks multi-file / vercel.json blast radius even when setting ON', async () => {
    const fetchImpl = vi.fn(async (url: string | URL | Request) => {
      const u = String(url)
      if (u.includes('/pulls/8/files')) {
        return json([{ filename: 'vercel.json' }])
      }
      if (u.includes('/pulls/8') && !u.includes('/files')) {
        return json({ head: { sha: 'x' }, number: 8 })
      }
      return new Response('no', { status: 404 })
    }) as unknown as typeof fetch

    const preview = {
      ..._idleForTests('f-blast', 'u1'),
      step: 'verified' as const,
      verifyOk: true,
      verifyDetail: 'ok',
      prNumber: 8,
      prUrl: 'https://github.com/o/r/pull/8',
    }
    const out = await maybeAutoMergeAfterPreviewVerify({
      findingId: 'f-blast',
      userId: 'u1',
      finding: {
        id: 'f-blast',
        siteId: null,
        topicId: '49',
        kind: 'k',
        verdict: 'auto-set-dimensions',
        surfaceClass: 'auto-fixable',
        autoFixable: true,
        reportOnly: false,
        pageUrl: 'https://example.com/x.html',
        bucket: 'actionable',
        severity: null,
        rollupKey: 'k',
        declarationSite: null,
        affectedUrlCount: 1,
        detail: 'd',
        proposedDiff: null,
        evidenceValues: null,
        sourceRows: [],
        firstSeenRunId: null,
        lastSeenRunId: null,
        firstSeenAt: null as unknown as string,
        lastSeenAt: null as unknown as string,
        userId: 'u1',
      },
      creds: { owner: 'o', repo: 'r', accessToken: 't' },
      previewState: preview,
      productionUrl: 'https://example.com/x.html',
      autoMergeEnabledOverride: true,
      fetchImpl,
    })
    expect(out.autoMerged).toBe(false)
    expect(out.autoMergeBlockedReason).toMatch(/site-wide|human-review/i)
  })
})

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  })
}
