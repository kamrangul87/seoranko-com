export type ApprovalBatchItem = {
  id: string
  label: string
  ok: boolean
  error?: string
  prUrl?: string | null
}

type FixActionBody = {
  error?: string
  fixFlow?: {
    step?: string
    errorDetail?: string | null
    commitDetail?: string | null
    prUrl?: string | null
  }
}

/** Prefer the server's error string (including a 200 commit that actually failed). */
export function fixActionError(
  body: FixActionBody,
  ok: boolean,
  status: number,
): string | null {
  const flow = body.fixFlow
  if (flow?.step === 'failed') {
    return flow.errorDetail || flow.commitDetail || body.error || 'Approve failed'
  }
  if (!ok) return body.error || `HTTP ${status}`
  return null
}

export function summarizeApprovalBatch(results: ApprovalBatchItem[]): string {
  const opened = results.filter((r) => r.ok)
  const failed = results.filter((r) => !r.ok)
  const lines: string[] = []
  if (opened.length > 0) {
    const urls = [
      ...new Set(opened.map((r) => r.prUrl).filter((u): u is string => Boolean(u))),
    ]
    if (urls.length <= 1) {
      lines.push(
        `${opened.length} page${opened.length === 1 ? '' : 's'} in 1 PR. SEORANKO does not merge customer PRs — merge them yourself.`,
      )
    } else {
      lines.push(
        `${urls.length} PRs opened. SEORANKO does not merge customer PRs — merge them yourself.`,
      )
    }
  }
  for (const item of failed) {
    lines.push(`${item.label}: ${item.error || 'Approve failed'}`)
  }
  if (lines.length === 0) return 'Nothing to approve'
  return lines.join('\n')
}
