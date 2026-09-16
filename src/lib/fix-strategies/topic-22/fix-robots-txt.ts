/**
 * Topic 22 fixers — only text/plain headers and crawl-delay removal.
 * Never edit Disallow. Never create robots.txt where none exists.
 */

/** Remove crawl-delay lines from robots.txt body. */
export function removeCrawlDelayLines(body: string): {
  body: string
  removed: number
} {
  let removed = 0
  const parts = body.split(/\r\n|\n|\r/)
  const kept: string[] = []
  for (const line of parts) {
    const stripped = line.replace(/#.*$/, '').trim()
    const key = stripped.split(':')[0]?.trim().toLowerCase()
    if (key === 'crawl-delay') {
      removed++
      continue
    }
    kept.push(line)
  }
  return { body: kept.join('\n'), removed }
}

/**
 * Propose Content-Type: text/plain for a robots route / headers config.
 * Does not create a robots.txt file.
 */
export function proposeTextPlainHeader(
  configSource: string,
): { source: string; updated: boolean } {
  if (/robots\.txt/.test(configSource) && /text\/plain/.test(configSource)) {
    return { source: configSource, updated: false }
  }
  if (/headers\s*\(/.test(configSource) || /headers\s*:\s*\[/.test(configSource)) {
    const snippet = `
  // robots.txt must be text/plain (topic 22)
  { source: '/robots.txt', headers: [{ key: 'Content-Type', value: 'text/plain; charset=utf-8' }] },
`
    if (/headers\s*:\s*\[/.test(configSource)) {
      return {
        source: configSource.replace(/headers\s*:\s*\[/, `headers: [${snippet}`),
        updated: true,
      }
    }
  }
  return {
    source: `${configSource.trim()}\n// Ensure /robots.txt Content-Type: text/plain; charset=utf-8\n`,
    updated: true,
  }
}

/** REJECTED — never auto-edit Disallow. */
export function rejectedDisallowEdit(): never {
  throw new Error(
    'REJECTED: never auto-edit a Disallow rule — blast radius is the entire origin',
  )
}

/** REJECTED — never create robots.txt where none exists. */
export function rejectedCreateRobotsTxt(): never {
  throw new Error(
    'REJECTED: never create a robots.txt where none exists — absence is not a defect',
  )
}
