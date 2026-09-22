/**
 * Append closed-loop entries to FIX_VERIFY_OUTCOME_RECORD.md.
 * Distinguishes auto_merged vs human merges.
 */

import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'

export type OutcomeRecordEntry = {
  origin: string
  topicId: string
  verdict: string
  pageUrl: string
  kind?: string
  detectedAt: string
  fixedAt: string
  prUrl: string
  prNumber: number
  mergeSha?: string | null
  /** True when the product merged under auto_merge_enabled gates. */
  autoMerged: boolean
  productionVerify: 'OK' | 'FAILED'
  productionVerifyDetail: string
  productionVerifiedAt: string
  revertPrUrl?: string | null
  outcome: 'closed' | 'production_verify_failed_revert_opened'
  fixDetail?: string
}

export function formatOutcomeEntry(
  entry: OutcomeRecordEntry,
  index: number,
): string {
  const lines = [
    ``,
    `---`,
    ``,
    `## ${index}. Topic ${entry.topicId} · \`${entry.verdict}\` · ${entry.pageUrl}`,
    ``,
    `| Field | Value |`,
    `|-------|-------|`,
    `| Origin | \`${entry.origin}\` |`,
    `| Topic | ${entry.topicId} |`,
    `| Verdict | \`${entry.verdict}\` |`,
    `| Page | ${entry.pageUrl} |`,
    entry.kind ? `| Kind | \`${entry.kind}\` |` : null,
    `| Detected | ${entry.detectedAt} |`,
    `| Fixed | ${entry.fixedAt} |`,
    `| PR | [${entry.prUrl}](${entry.prUrl}) (#${entry.prNumber}) |`,
    entry.mergeSha ? `| Merge SHA | \`${entry.mergeSha}\` |` : null,
    `| auto_merged | **${entry.autoMerged}** |`,
    `| Production verify | **${entry.productionVerify}** — ${entry.productionVerifiedAt} |`,
    `| Production detail | ${entry.productionVerifyDetail} |`,
    entry.revertPrUrl
      ? `| Revert PR | [${entry.revertPrUrl}](${entry.revertPrUrl}) |`
      : null,
    entry.fixDetail ? `| Fix detail | ${entry.fixDetail} |` : null,
    `| Outcome | **${entry.outcome}** |`,
    ``,
  ].filter((l): l is string => l != null)
  return lines.join('\n')
}

export function nextOutcomeIndex(existingMarkdown: string): number {
  const matches = existingMarkdown.match(/^## \d+\./gm)
  return (matches?.length ?? 0) + 1
}

/**
 * Append an outcome entry to the ledger file (local workspace).
 * Returns the written path, or null if the file could not be written.
 */
export function appendOutcomeRecordLocal(
  entry: OutcomeRecordEntry,
  repoRoot = process.cwd(),
): { ok: true; path: string; index: number } | { ok: false; error: string } {
  const path = resolve(
    repoRoot,
    'docs/fix-strategies/FIX_VERIFY_OUTCOME_RECORD.md',
  )
  try {
    let existing = ''
    if (existsSync(path)) {
      existing = readFileSync(path, 'utf8')
    } else {
      existing = [
        `# Fix → verify → outcome record`,
        ``,
        `Ledger of findings that completed the full loop: detect → fix (PR) →`,
        `production verify → (optional) recrawl.`,
        ``,
        `\`auto_merged: true\` = product merged under site \`auto_merge_enabled\` gates.`,
        `\`auto_merged: false\` = human merged the customer PR.`,
        ``,
      ].join('\n')
      writeFileSync(path, existing, 'utf8')
    }
    // Backfill note on first human entry if missing auto_merged column.
    if (
      existing.includes('## 1.') &&
      !existing.includes('| auto_merged |')
    ) {
      existing = existing.replace(
        `| PR | [kamrangul87/autodun-ai#34](https://github.com/kamrangul87/autodun-ai/pull/34) — merge \`9ad64e0\` |`,
        `| PR | [kamrangul87/autodun-ai#34](https://github.com/kamrangul87/autodun-ai/pull/34) — merge \`9ad64e0\` |\n| auto_merged | **false** |`,
      )
      writeFileSync(path, existing, 'utf8')
    }
    const index = nextOutcomeIndex(existing)
    appendFileSync(path, formatOutcomeEntry(entry, index), 'utf8')
    return { ok: true, path, index }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : String(e),
    }
  }
}
