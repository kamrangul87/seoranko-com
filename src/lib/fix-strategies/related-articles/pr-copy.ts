export type RelatedPrTarget = {
  href: string
  anchorText: string
  reason?: string
}

export type RelatedPrRow = {
  sourcePath: string
  sourceUrl?: string | null
  targets: RelatedPrTarget[]
}

export function relatedReadingPrTitle(pageCount: number): string {
  const n = Math.max(1, pageCount)
  return `SEORANKO: add related reading links (${n} page${n === 1 ? '' : 's'})`
}

function cell(value: string): string {
  return value.replace(/\|/g, '\\|').replace(/\n/g, ' ').trim()
}

export function relatedReadingPrBody(rows: RelatedPrRow[]): string {
  const lines: string[] = [
    '## Summary',
    '',
    'SEORANKO related reading links. **Never auto-merged** — review and merge this PR yourself.',
    '',
    '| Source | Target | Anchor | Reason |',
    '| --- | --- | --- | --- |',
  ]
  for (const row of rows) {
    const source = row.sourcePath || row.sourceUrl || ''
    const targets = row.targets.length > 0 ? row.targets : [{ href: '', anchorText: '' }]
    for (const t of targets) {
      lines.push(
        `| ${cell(source)} | ${cell(t.href)} | ${cell(t.anchorText)} | ${cell(t.reason || 'Related reading')} |`,
      )
    }
  }
  return lines.join('\n')
}
