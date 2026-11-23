import { describe, expect, it } from 'vitest'
import { BANNED_CLAIM_WORDS_RE } from './copy-rules'
import { ABOUT_COPY, collectAboutCopyStrings } from './about-copy'

describe('about page copy', () => {
  it('names the founder Kamran and describes the product without a parent company or visa', () => {
    const text = collectAboutCopyStrings().join('\n')
    expect(text).toMatch(/\bKamran\b/)
    expect(text).toMatch(/crawl/i)
    expect(text).toMatch(/GitHub/)
    expect(text).toMatch(/pull request/i)
    expect(text).toMatch(/Search Console/)
    expect(text).toMatch(/link map/i)
    expect(text).toMatch(/Next\.js/)
    expect(text).toMatch(/Vercel/)
    expect(text).toMatch(/white-hat|Search Essentials|spam policies/i)
    expect(text).not.toMatch(/MINSO/i)
    expect(text).not.toMatch(/holding company|parent company/i)
    expect(text).not.toMatch(/visa|global talent/i)
    expect(ABOUT_COPY.founderName).toBe('Kamran')
  })

  it('does not claim rankings, traffic, position, or penalties', () => {
    for (const s of collectAboutCopyStrings()) {
      expect(s).not.toMatch(BANNED_CLAIM_WORDS_RE)
    }
  })
})
