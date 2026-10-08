/**
 * Wait for a Vercel (or GitHub) deployment of a PR branch, then return the
 * preview URL to verify against. Does not merge to main.
 *
 * Sources (in order) — never invent a URL from a naming pattern:
 * 1. GitHub Deployments API (by SHA, then by ref) → success environment_url
 * 2. Commit statuses for that SHA with a *.vercel.app target_url
 * 3. Check-runs for that SHA with a *.vercel.app details/html URL
 * 4. vercel[bot] PR comment previewUrl / Preview markdown link (when PR known)
 */

export type DeployWaitResult =
  | {
      ok: true
      previewUrl: string
      deploymentId?: string
      state: string
      detail: string
      source: PreviewUrlSource
    }
  | { ok: false; error: string; pending?: boolean }

export type PreviewUrlSource =
  | 'github_deployment'
  | 'commit_status'
  | 'check_run'
  | 'pr_comment'

type GhDeployment = {
  id: number
  sha?: string
  ref?: string
  environment?: string
  transient_environment?: boolean
  production_environment?: boolean
  statuses_url?: string
  created_at?: string
}

type GhStatus = {
  state?: string
  context?: string
  environment_url?: string
  target_url?: string
  description?: string
  created_at?: string
}

type GhCheckRun = {
  id?: number
  name?: string
  status?: string
  conclusion?: string
  details_url?: string | null
  html_url?: string | null
  output?: { title?: string | null; summary?: string | null; text?: string | null }
  app?: { slug?: string | null }
}

type GhIssueComment = {
  id?: number
  user?: { login?: string | null }
  body?: string | null
  created_at?: string
  updated_at?: string
}

const GH = 'https://api.github.com'

/** Plain copy when a resolved preview origin is login-gated. */
export const PREVIEW_AUTH_BLOCKED_MESSAGE =
  'Your preview is protected by a login; turn off Vercel Authentication for previews'

function ghHeaders(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  }
}

function normalizePreviewOrigin(raw: string): string | null {
  const trimmed = raw.trim()
  if (!trimmed) return null
  const withScheme = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`
  try {
    const u = new URL(withScheme)
    if (!/\.vercel\.app$/i.test(u.hostname)) return null
    return u.origin
  } catch {
    return null
  }
}

function extractVercelAppUrls(text: string): string[] {
  const out: string[] = []
  const re = /https?:\/\/[a-zA-Z0-9][-a-zA-Z0-9.]*\.vercel\.app/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const origin = normalizePreviewOrigin(m[0])
    if (origin && !out.includes(origin)) out.push(origin)
  }
  // Host-only previewUrl from Vercel bot payload
  const hostRe =
    /(?:^|["'\s])((?:[a-zA-Z0-9][-a-zA-Z0-9.]*)\.vercel\.app)(?:["'\s]|$)/gi
  while ((m = hostRe.exec(text)) !== null) {
    const origin = normalizePreviewOrigin(m[1])
    if (origin && !out.includes(origin)) out.push(origin)
  }
  return out
}

/** Decode Vercel bot `[vc]: #…=BASE64` first-line payload → previewUrl when present. */
export function previewUrlFromVercelBotComment(body: string): string | null {
  const first = (body || '').split('\n')[0] || ''
  const m = first.match(/^\[vc\]:\s*#[^=]*=([A-Za-z0-9+/=_-]+)\s*$/)
  if (m) {
    try {
      const json = Buffer.from(m[1], 'base64').toString('utf8')
      const parsed = JSON.parse(json) as {
        projects?: Array<{ previewUrl?: string; nextCommitStatus?: string }>
      }
      for (const p of parsed.projects || []) {
        const status = String(p.nextCommitStatus || '').toUpperCase()
        if (status && status !== 'DEPLOYED' && status !== 'READY') continue
        const origin = normalizePreviewOrigin(String(p.previewUrl || ''))
        if (origin) return origin
      }
      // Prefer any non-empty previewUrl even if status field is absent
      for (const p of parsed.projects || []) {
        const origin = normalizePreviewOrigin(String(p.previewUrl || ''))
        if (origin) return origin
      }
    } catch {
      /* fall through to markdown */
    }
  }
  // Markdown: [Preview](https://….vercel.app)
  const md = body.match(/\[Preview\]\((https?:\/\/[^)\s]+\.vercel\.app[^)\s]*)\)/i)
  if (md) {
    const origin = normalizePreviewOrigin(md[1])
    if (origin) return origin
  }
  const urls = extractVercelAppUrls(body)
  return urls[0] || null
}

async function readJson(
  fetchImpl: typeof fetch,
  url: string,
  token: string,
): Promise<{ ok: boolean; status: number; data: unknown; text: string }> {
  const res = await fetchImpl(url, {
    headers: ghHeaders(token),
    signal: AbortSignal.timeout(20000),
  })
  const text = await res.text().catch(() => '')
  let data: unknown = null
  try {
    data = text ? JSON.parse(text) : null
  } catch {
    data = null
  }
  return { ok: res.ok, status: res.status, data, text }
}

async function previewUrlFromDeployments(
  deployments: GhDeployment[],
  fetchImpl: typeof fetch,
  token: string,
  sha: string,
): Promise<DeployWaitResult | null> {
  if (!Array.isArray(deployments) || deployments.length === 0) return null

  const ordered = [...deployments].sort((a, b) => {
    const aProd = a.production_environment ? 1 : 0
    const bProd = b.production_environment ? 1 : 0
    if (aProd !== bProd) return aProd - bProd
    // Prefer Preview-named environments
    const aPrev = /preview/i.test(String(a.environment || '')) ? 0 : 1
    const bPrev = /preview/i.test(String(b.environment || '')) ? 0 : 1
    return aPrev - bPrev
  })

  let sawInProgress = false
  for (const d of ordered) {
    if (d.sha && d.sha !== sha) continue
    if (!d.statuses_url) continue
    const st = await readJson(fetchImpl, d.statuses_url, token)
    if (!st.ok) continue
    const statuses = (Array.isArray(st.data) ? st.data : []) as GhStatus[]
    const success = statuses.find(
      (s) =>
        s.state === 'success' && Boolean(s.environment_url || s.target_url),
    )
    if (success) {
      const previewUrl = normalizePreviewOrigin(
        success.environment_url || success.target_url || '',
      )
      if (!previewUrl) continue
      return {
        ok: true,
        previewUrl,
        deploymentId: String(d.id),
        state: 'success',
        detail: `Preview deploy ready: ${previewUrl}`,
        source: 'github_deployment',
      }
    }
    if (
      statuses.some((s) =>
        ['pending', 'in_progress', 'queued'].includes(String(s.state)),
      )
    ) {
      sawInProgress = true
    }
  }
  if (sawInProgress) {
    return {
      ok: false,
      pending: true,
      error: 'GitHub deployment still in progress for this SHA',
    }
  }
  return null
}

async function previewUrlFromCommitStatuses(
  fetchImpl: typeof fetch,
  owner: string,
  repo: string,
  sha: string,
  token: string,
): Promise<DeployWaitResult | null> {
  const st = await readJson(
    fetchImpl,
    `${GH}/repos/${owner}/${repo}/commits/${sha}/statuses?per_page=100`,
    token,
  )
  if (!st.ok) {
    return {
      ok: false,
      pending: true,
      error: `Commit statuses HTTP ${st.status}`,
    }
  }
  const statuses = (Array.isArray(st.data) ? st.data : []) as GhStatus[]
  const vercelish = statuses.filter((s) =>
    /vercel/i.test(String(s.context || '')),
  )
  const successWithApp = vercelish.find((s) => {
    if (s.state !== 'success') return false
    return Boolean(
      normalizePreviewOrigin(s.target_url || '') ||
        normalizePreviewOrigin(s.environment_url || ''),
    )
  })
  if (successWithApp) {
    const previewUrl = normalizePreviewOrigin(
      successWithApp.environment_url || successWithApp.target_url || '',
    )!
    return {
      ok: true,
      previewUrl,
      state: 'success',
      detail: `Preview from commit status: ${previewUrl}`,
      source: 'commit_status',
    }
  }
  if (
    vercelish.some((s) =>
      ['pending', 'in_progress', 'queued'].includes(String(s.state)),
    )
  ) {
    return {
      ok: false,
      pending: true,
      error: 'Vercel commit status still pending for this SHA',
    }
  }
  // Combined status endpoint (includes nested statuses + state)
  const combined = await readJson(
    fetchImpl,
    `${GH}/repos/${owner}/${repo}/commits/${sha}/status`,
    token,
  )
  if (combined.ok && combined.data && typeof combined.data === 'object') {
    const nested = (combined.data as { statuses?: GhStatus[] }).statuses || []
    for (const s of nested) {
      if (s.state !== 'success') continue
      const previewUrl = normalizePreviewOrigin(
        s.environment_url || s.target_url || '',
      )
      if (previewUrl) {
        return {
          ok: true,
          previewUrl,
          state: 'success',
          detail: `Preview from combined status: ${previewUrl}`,
          source: 'commit_status',
        }
      }
    }
  }
  return null
}

async function previewUrlFromCheckRuns(
  fetchImpl: typeof fetch,
  owner: string,
  repo: string,
  sha: string,
  token: string,
): Promise<DeployWaitResult | null> {
  const cr = await readJson(
    fetchImpl,
    `${GH}/repos/${owner}/${repo}/commits/${sha}/check-runs?per_page=100`,
    token,
  )
  if (!cr.ok) {
    if (cr.status === 403 || cr.status === 404) return null
    return {
      ok: false,
      pending: true,
      error: `Check-runs HTTP ${cr.status}`,
    }
  }
  const runs = (
    cr.data && typeof cr.data === 'object'
      ? (cr.data as { check_runs?: GhCheckRun[] }).check_runs || []
      : []
  ) as GhCheckRun[]
  const vercelRuns = runs.filter(
    (r) =>
      /vercel/i.test(String(r.name || '')) ||
      /vercel/i.test(String(r.app?.slug || '')),
  )
  for (const r of vercelRuns) {
    if (r.status && r.status !== 'completed') {
      return {
        ok: false,
        pending: true,
        error: `Vercel check-run still ${r.status}`,
      }
    }
    if (r.conclusion && r.conclusion !== 'success') continue
    const blob = [
      r.details_url || '',
      r.html_url || '',
      r.output?.summary || '',
      r.output?.text || '',
      r.output?.title || '',
    ].join('\n')
    const urls = extractVercelAppUrls(blob)
    if (urls[0]) {
      return {
        ok: true,
        previewUrl: urls[0],
        state: 'success',
        detail: `Preview from check-run: ${urls[0]}`,
        source: 'check_run',
      }
    }
  }
  return null
}

/** Whether the Vercel commit status for this exact SHA is success / pending / absent. */
async function vercelCommitStatusReady(
  fetchImpl: typeof fetch,
  owner: string,
  repo: string,
  sha: string,
  token: string,
): Promise<'success' | 'pending' | 'absent'> {
  const st = await readJson(
    fetchImpl,
    `${GH}/repos/${owner}/${repo}/commits/${sha}/statuses?per_page=100`,
    token,
  )
  if (!st.ok) return 'absent'
  const statuses = (Array.isArray(st.data) ? st.data : []) as GhStatus[]
  const vercelish = statuses.filter((s) => /vercel/i.test(String(s.context || '')))
  if (vercelish.length === 0) return 'absent'
  if (vercelish.some((s) => s.state === 'success')) return 'success'
  if (
    vercelish.some((s) =>
      ['pending', 'in_progress', 'queued'].includes(String(s.state)),
    )
  ) {
    return 'pending'
  }
  return 'absent'
}

async function previewUrlFromPrComments(
  fetchImpl: typeof fetch,
  owner: string,
  repo: string,
  prNumber: number,
  token: string,
): Promise<DeployWaitResult | null> {
  const comments = await readJson(
    fetchImpl,
    `${GH}/repos/${owner}/${repo}/issues/${prNumber}/comments?per_page=100`,
    token,
  )
  if (!comments.ok) {
    if (comments.status === 403 || comments.status === 404) {
      return {
        ok: false,
        pending: true,
        error: `PR comments HTTP ${comments.status}`,
      }
    }
    return {
      ok: false,
      pending: true,
      error: `PR comments HTTP ${comments.status}`,
    }
  }
  const list = (Array.isArray(comments.data) ? comments.data : []) as GhIssueComment[]
  const bot = list
    .filter((c) => /vercel\[bot\]/i.test(String(c.user?.login || '')))
    .reverse() // newest last in API; prefer latest
  for (const c of bot) {
    const previewUrl = previewUrlFromVercelBotComment(String(c.body || ''))
    if (previewUrl) {
      return {
        ok: true,
        previewUrl,
        state: 'success',
        detail: `Preview from vercel[bot] PR comment: ${previewUrl}`,
        source: 'pr_comment',
      }
    }
  }
  if (bot.length > 0) {
    return {
      ok: false,
      pending: true,
      error: 'vercel[bot] commented but no preview URL for this commit yet',
    }
  }
  return {
    ok: false,
    pending: true,
    error: 'No vercel[bot] PR comment with a preview URL yet',
  }
}

/**
 * Optional reachability check — 401/403 mean Vercel Authentication is on.
 */
export async function probePreviewAuth(
  previewUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ blocked: boolean; status?: number }> {
  try {
    const res = await fetchImpl(previewUrl.replace(/\/$/, '') + '/', {
      method: 'GET',
      redirect: 'manual',
      headers: { 'User-Agent': 'SEORANKO-Preview-Probe/1.0' },
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 401 || res.status === 403) {
      return { blocked: true, status: res.status }
    }
    // Some auth walls return 200 with SSO interstitial — treat as blocked too.
    if (res.status >= 200 && res.status < 400) {
      const text = await res.text().catch(() => '')
      if (
        /vercel\.com\/sso-api|Authentication Required|\/_vercel\//i.test(text) &&
        text.length < 50_000
      ) {
        return { blocked: true, status: res.status }
      }
    }
    return { blocked: false, status: res.status }
  } catch {
    return { blocked: false }
  }
}

/**
 * Poll GitHub deployment statuses for the PR head SHA / branch until a
 * preview environment URL is ready (Vercel posts these).
 */
export async function waitForPrPreviewDeploy(input: {
  owner: string
  repo: string
  branchName: string
  accessToken: string
  prNumber?: number
  /** Max wait ms (default 15 min). */
  timeoutMs?: number
  pollMs?: number
  fetchImpl?: typeof fetch
}): Promise<DeployWaitResult> {
  const fetchImpl = input.fetchImpl ?? fetch
  const timeoutMs = input.timeoutMs ?? 15 * 60 * 1000
  const pollMs = input.pollMs ?? 15_000
  const started = Date.now()
  let lastError = 'No preview URL signal yet'

  while (Date.now() - started < timeoutMs) {
    const once = await checkPreviewOnce({
      owner: input.owner,
      repo: input.repo,
      branchName: input.branchName,
      accessToken: input.accessToken,
      prNumber: input.prNumber,
      fetchImpl,
    })
    if (once.ok) return once
    if (!once.pending) return once
    lastError = once.error
    await sleep(pollMs)
  }

  return {
    ok: false,
    pending: false,
    error: `No preview URL within 15 minutes — missing signal: ${lastError}`,
  }
}

export async function checkPreviewOnce(input: {
  owner: string
  repo: string
  branchName: string
  accessToken: string
  /** When set, vercel[bot] PR comments are consulted as a fallback source. */
  prNumber?: number
  fetchImpl: typeof fetch
  /** When true (default), probe the resolved URL for Vercel Authentication. */
  probeAuth?: boolean
}): Promise<DeployWaitResult> {
  const { owner, repo, branchName, accessToken, fetchImpl } = input
  const probeAuth = input.probeAuth !== false

  const refRes = await readJson(
    fetchImpl,
    `${GH}/repos/${owner}/${repo}/git/ref/heads/${encodeURIComponent(branchName)}`,
    accessToken,
  )
  if (!refRes.ok) {
    return {
      ok: false,
      pending: true,
      error: `Branch ref not found yet (HTTP ${refRes.status})`,
    }
  }
  const sha = (refRes.data as { object?: { sha?: string } } | null)?.object?.sha
  if (!sha) {
    return { ok: false, pending: true, error: 'Branch SHA missing' }
  }

  const signals: string[] = []

  // ── 1a. Deployments by SHA ──────────────────────────────────────
  const depBySha = await readJson(
    fetchImpl,
    `${GH}/repos/${owner}/${repo}/deployments?sha=${sha}&per_page=10`,
    accessToken,
  )
  console.info('[preview-discover] deployments_by_sha', {
    owner,
    repo,
    sha,
    status: depBySha.status,
    count: Array.isArray(depBySha.data) ? depBySha.data.length : null,
    body: depBySha.ok
      ? undefined
      : depBySha.text.slice(0, 300),
  })
  if (!depBySha.ok) {
    signals.push(`deployments_by_sha HTTP ${depBySha.status}`)
  } else {
    const fromDep = await previewUrlFromDeployments(
      (depBySha.data as GhDeployment[]) || [],
      fetchImpl,
      accessToken,
      sha,
    )
    if (fromDep?.ok) return maybeProbe(fromDep, fetchImpl, probeAuth)
    if (fromDep && !fromDep.ok && fromDep.pending) {
      signals.push(fromDep.error)
    } else if (
      Array.isArray(depBySha.data) &&
      (depBySha.data as GhDeployment[]).length === 0
    ) {
      signals.push('no GitHub deployments for this SHA')
    }
  }

  // ── 1b. Deployments by ref (branch) ─────────────────────────────
  const depByRef = await readJson(
    fetchImpl,
    `${GH}/repos/${owner}/${repo}/deployments?ref=${encodeURIComponent(branchName)}&per_page=10`,
    accessToken,
  )
  console.info('[preview-discover] deployments_by_ref', {
    owner,
    repo,
    ref: branchName,
    status: depByRef.status,
    count: Array.isArray(depByRef.data) ? depByRef.data.length : null,
  })
  if (!depByRef.ok) {
    signals.push(`deployments_by_ref HTTP ${depByRef.status}`)
  } else {
    const fromDep = await previewUrlFromDeployments(
      (depByRef.data as GhDeployment[]) || [],
      fetchImpl,
      accessToken,
      sha,
    )
    if (fromDep?.ok) return maybeProbe(fromDep, fetchImpl, probeAuth)
    if (fromDep && !fromDep.ok && fromDep.pending) {
      signals.push(fromDep.error)
    }
  }

  // ── 2. Commit statuses ──────────────────────────────────────────
  const fromStatus = await previewUrlFromCommitStatuses(
    fetchImpl,
    owner,
    repo,
    sha,
    accessToken,
  )
  console.info('[preview-discover] commit_statuses', {
    owner,
    repo,
    sha,
    result: fromStatus
      ? fromStatus.ok
        ? { ok: true, source: fromStatus.source, url: fromStatus.previewUrl }
        : { ok: false, error: fromStatus.error }
      : { ok: false, error: 'no vercel.app URL on commit statuses' },
  })
  if (fromStatus?.ok) return maybeProbe(fromStatus, fetchImpl, probeAuth)
  if (fromStatus && !fromStatus.ok) signals.push(fromStatus.error)
  else signals.push('no vercel.app URL on commit statuses for this SHA')

  // ── 3. Check-runs ───────────────────────────────────────────────
  const fromChecks = await previewUrlFromCheckRuns(
    fetchImpl,
    owner,
    repo,
    sha,
    accessToken,
  )
  console.info('[preview-discover] check_runs', {
    owner,
    repo,
    sha,
    result: fromChecks
      ? fromChecks.ok
        ? { ok: true, url: fromChecks.previewUrl }
        : { ok: false, error: fromChecks.error }
      : { ok: false, error: 'no vercel.app URL on check-runs' },
  })
  if (fromChecks?.ok) return maybeProbe(fromChecks, fetchImpl, probeAuth)
  if (fromChecks && !fromChecks.ok) signals.push(fromChecks.error)
  else signals.push('no vercel.app URL on check-runs for this SHA')

  // ── 4. vercel[bot] PR comment (only when this SHA's Vercel status is success)
  if (input.prNumber != null && input.prNumber > 0) {
    const vercelReady = await vercelCommitStatusReady(
      fetchImpl,
      owner,
      repo,
      sha,
      accessToken,
    )
    if (vercelReady === 'pending') {
      signals.push('Vercel commit status still pending for this SHA')
    } else if (vercelReady === 'success') {
      const fromComment = await previewUrlFromPrComments(
        fetchImpl,
        owner,
        repo,
        input.prNumber,
        accessToken,
      )
      console.info('[preview-discover] pr_comments', {
        owner,
        repo,
        prNumber: input.prNumber,
        sha,
        result: fromComment
          ? fromComment.ok
            ? { ok: true, url: fromComment.previewUrl }
            : { ok: false, error: fromComment.error }
          : { ok: false, error: 'no comment source' },
      })
      if (fromComment?.ok) return maybeProbe(fromComment, fetchImpl, probeAuth)
      if (fromComment && !fromComment.ok) signals.push(fromComment.error)
    } else {
      signals.push('no successful Vercel commit status for this SHA (PR comment skipped)')
    }
  } else {
    signals.push('no PR number for vercel[bot] comment fallback')
  }

  // Prefer the most actionable missing-signal phrase
  const primary =
    signals.find((s) => /HTTP 403/.test(s)) ||
    signals.find((s) => /no GitHub deployments/.test(s)) ||
    signals[signals.length - 1] ||
    'no preview URL signal'

  return {
    ok: false,
    pending: true,
    error: primary,
  }
}

async function maybeProbe(
  result: Extract<DeployWaitResult, { ok: true }>,
  fetchImpl: typeof fetch,
  probeAuth: boolean,
): Promise<DeployWaitResult> {
  if (!probeAuth) return result
  const probe = await probePreviewAuth(result.previewUrl, fetchImpl)
  if (probe.blocked) {
    return {
      ok: false,
      pending: false,
      error: PREVIEW_AUTH_BLOCKED_MESSAGE,
    }
  }
  return result
}

/** Join preview origin with the page path from the production pageUrl. */
export function previewPageUrl(previewOrigin: string, productionPageUrl: string): string {
  let path = '/'
  try {
    path = new URL(productionPageUrl).pathname || '/'
  } catch {
    path = productionPageUrl.startsWith('/') ? productionPageUrl : `/${productionPageUrl}`
  }
  return `${previewOrigin.replace(/\/$/, '')}${path}`
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms))
}
