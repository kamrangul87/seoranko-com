import { describe, expect, it } from 'vitest'
import {
  extractTargetPathFromCommitMessage,
  findBlockingAttempt,
  fixContentFingerprint,
  isDuplicateFixPrTitle,
  normalizeFixTargetPath,
} from './fix-agent-idempotency'

describe('fix-agent-idempotency', () => {
  it('normalizes public paths and site URLs to a comparable key', () => {
    expect(normalizeFixTargetPath('public/blog/index.html')).toBe('public/blog/index.html')
    expect(normalizeFixTargetPath('https://example.com/blog/')).toBe('/blog')
    expect(normalizeFixTargetPath('https://example.com/blog/index.html')).toBe('/blog')
  })

  it('fingerprints are stable for identical content and change when content changes', () => {
    const a = fixContentFingerprint({
      autoKind: 'rewrite-link-href',
      targetPath: 'public/blog/index.html',
      content: '<a href="/a">x</a>',
    })
    const b = fixContentFingerprint({
      autoKind: 'rewrite-link-href',
      targetPath: 'public/blog/index.html',
      content: '<a href="/a">x</a>',
    })
    const c = fixContentFingerprint({
      autoKind: 'rewrite-link-href',
      targetPath: 'public/blog/index.html',
      content: '<a href="/b">x</a>',
    })
    expect(a).toBe(b)
    expect(a).not.toBe(c)
  })

  it('extracts target path from Fix Agent commit titles', () => {
    expect(
      extractTargetPathFromCommitMessage(
        'SEORANKO Fix Agent: rewrite 2 link href(s) on public/blog/index.html',
      ),
    ).toBe('public/blog/index.html')
  })

  it('detects duplicate open-PR titles for the same target file', () => {
    const t = 'SEORANKO Fix Agent: rewrite 2 link href(s) on public/blog/index.html'
    expect(isDuplicateFixPrTitle(t, t)).toBe(true)
    expect(
      isDuplicateFixPrTitle(
        t,
        'SEORANKO Fix Agent: rewrite 2 link href(s) on public/blog/other.html',
      ),
    ).toBe(false)
  })

  it('blocks re-attempt when an unverified row shares issue_key', () => {
    const hit = findBlockingAttempt(
      [
        {
          id: '1',
          issue_key: 'rewrite-link-href::/blog',
          status: 'unverified',
        },
      ],
      { issueKey: 'rewrite-link-href::/blog' },
    )
    expect(hit?.status).toBe('unverified')
  })

  it('blocks re-attempt when a pending_merge row shares issue_key', () => {
    const hit = findBlockingAttempt(
      [
        {
          issue_key: 'link_href_blog',
          auto_kind: 'rewrite-link-href',
          status: 'pending_merge',
        },
      ],
      { issueKey: 'link_href_blog', autoKind: 'rewrite-link-href' },
    )
    expect(hit?.status).toBe('pending_merge')
  })

  it('does not block failed attempts', () => {
    const hit = findBlockingAttempt(
      [
        {
          issue_key: 'link_href_blog',
          auto_kind: 'rewrite-link-href',
          status: 'failed',
        },
      ],
      { issueKey: 'link_href_blog', autoKind: 'rewrite-link-href' },
    )
    expect(hit).toBeNull()
  })
})
