/**
 * Regression: domain names with periods must not break naive sentence / typo regexes.
 * (Standing bug class — gov.uk, energynetworks.org, etc.)
 */

import { describe, expect, it } from 'vitest'
import { splitSentences, countSentences } from './sentence-boundaries'

describe('domain names vs period-based regex', () => {
  it('does not split on gov.uk / energynetworks.org style hosts', () => {
    const text =
      'See guidance at https://www.gov.uk/guidance and https://energynetworks.org/docs for details.'
    expect(countSentences(text)).toBe(1)
    const sentences = splitSentences(text)
    expect(sentences).toHaveLength(1)
    expect(sentences[0]).toContain('gov.uk')
    expect(sentences[0]).toContain('energynetworks.org')
  })
})
