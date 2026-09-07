/**
 * Fix Agent idempotency — skip re-applying an identical fix that is already
 * pending (PR/deploy) or verified, so we do not open duplicate PRs.
 */

export type IdempotentAttemptRow = {
  id?: string
  issue_key?: string | null
  issue_id?: string | null
  auto_kind?: string | null
  status?: string | null
  target_url?: string | null
  diff_summary?: string | null
  verification_detail?: string | null
  error_message?: string | null
  created_at?: string | null
}

/** Statuses that mean "this fix is already in flight or done — do not re-open". */
export const BLOCKING_FIX_STATUSES = new Set([
  'pending_merge',
  'pending_deploy',
  'applied',
  'verified',
  'awaiting_deploy',
])

export function normalizeFixTargetPath(pathOrUrl: string | null | undefined): string {
  if (!pathOrUrl) return ''
  const raw = pathOrUrl.trim()
  try {
    if (/^https?:\/\//i.test(raw)) {
      const u = new URL(raw)
      let p = u.pathname.replace(/\/+$/, '') || '/'
      if (p.endsWith('/index.html')) p = p.slice(0, -'/index.html'.length) || '/'
      return p.toLowerCase()
    }
  } catch {
    /* fall through */
  }
  return raw.replace(/^\/+/, '').toLowerCase()
}

/** Stable fingerprint for "same file + same fix type + same resulting content". */
export function fixContentFingerprint(opts: {
  autoKind: string
  targetPath: string
  content: string
}): string {
  const path = normalizeFixTargetPath(opts.targetPath)
  // FNV-1a 32-bit — deterministic, no crypto dependency in edge bundles.
  let hash = 0x811c9dc5
  const input = `${opts.autoKind}|${path}|${opts.content}`
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193)
  }
  return (hash >>> 0).toString(16).padStart(8, '0')
}

export function extractTargetPathFromCommitMessage(message: string): string | null {
  const m = message.match(/\bon\s+((?:public\/)?[\w./-]+\.html)\b/i)
  return m ? m[1] : null
}

/**
 * True when an open PR title already represents the same Fix Agent commit
 * (same message → same target file + rewrite count).
 */
export function isDuplicateFixPrTitle(existingTitle: string, candidateTitle: string): boolean {
  const a = existingTitle.trim().toLowerCase()
  const b = candidateTitle.trim().toLowerCase()
  if (!a || !b) return false
  if (a === b) return true
  const pathA = extractTargetPathFromCommitMessage(a)
  const pathB = extractTargetPathFromCommitMessage(b)
  if (pathA && pathB && pathA.toLowerCase() === pathB.toLowerCase()) {
    // Same file + both SEORANKO Fix Agent link-href / dead-link style titles
    const fixA = /rewrite \d+ link href|remove dead link/i.test(a)
    const fixB = /rewrite \d+ link href|remove dead link/i.test(b)
    return fixA && fixB
  }
  return false
}

export function findBlockingAttempt(
  rows: IdempotentAttemptRow[],
  opts: {
    issueKey?: string | null
    issueId?: string | null
    autoKind: string
    /** Optional path/URL the fix edits */
    targetPath?: string | null
    contentFingerprint?: string | null
  },
): IdempotentAttemptRow | null {
  for (const row of rows) {
    if (!BLOCKING_FIX_STATUSES.has(String(row.status || ''))) continue
    if (row.auto_kind && row.auto_kind !== opts.autoKind) continue

    if (opts.issueKey && row.issue_key && row.issue_key === opts.issueKey) {
      return row
    }
    if (opts.issueId && row.issue_id && row.issue_id === opts.issueId) {
      return row
    }

    if (opts.targetPath && row.diff_summary) {
      const path = normalizeFixTargetPath(opts.targetPath)
      if (path && row.diff_summary.toLowerCase().includes(path)) {
        if (
          !opts.contentFingerprint ||
          (row.verification_detail || '').includes(opts.contentFingerprint) ||
          (row.diff_summary || '').includes(opts.contentFingerprint)
        ) {
          return row
        }
      }
    }

    if (
      opts.contentFingerprint &&
      ((row.verification_detail || '').includes(opts.contentFingerprint) ||
        (row.diff_summary || '').includes(opts.contentFingerprint))
    ) {
      return row
    }
  }
  return null
}
