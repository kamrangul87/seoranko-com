import { describe, it, expect } from 'vitest'
import { deriveIssueKey } from './issue-key'

describe('deriveIssueKey', () => {
  it('collapses dynamic-value messages from the same condition to one stable key', () => {
    const a = deriveIssueKey({ category: 'onpage', message: 'Title too long (72 chars) — will be truncated in Google results' })
    const b = deriveIssueKey({ category: 'onpage', message: 'Title too long (81 chars) — will be truncated in Google results' })
    expect(a).toBe(b)
    expect(a).toBe('title_too_long')
  })

  it('disambiguates same-category messages that share the word "Only"', () => {
    const h2 = deriveIssueKey({ category: 'onpage', message: 'Only 1 H2 heading for a 900-word page' })
    const links = deriveIssueKey({ category: 'links', message: 'Only 2 internal links — add more to improve crawlability' })
    const answers = deriveIssueKey({ category: 'ai', message: 'Only 1 answer-length passage (134-167 words) — AI engines extract citable passages from this range' })
    expect(new Set([h2, links, answers]).size).toBe(3)
  })

  it('keys the 404 branch distinctly from a generic fetch failure', () => {
    const notFound = deriveIssueKey({ category: 'crawlability', message: 'Page not found (404) — this route does not exist yet' })
    const fetchFail = deriveIssueKey({ category: 'crawlability', message: 'Page cannot be accessed: timeout of 8000ms exceeded' })
    expect(notFound).toBe('page_not_found')
    expect(fetchFail).toBe('page_fetch_error')
    expect(notFound).not.toBe(fetchFail)
  })

  it('never returns an empty key, even for an unrecognised message', () => {
    const key = deriveIssueKey({ category: 'onpage', message: 'Some brand-new check text nobody wrote a rule for yet' })
    expect(key).toBeTruthy()
    expect(key.length).toBeGreaterThan(0)
  })

  it('is deterministic for the fallback path', () => {
    const issue = { category: 'schema', message: 'A totally novel message with "a quoted part" and 42 numbers' }
    expect(deriveIssueKey(issue)).toBe(deriveIssueKey(issue))
  })
})
