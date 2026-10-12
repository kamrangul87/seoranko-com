/**
 * Draft fixture case under fixtures/failure-cases/<signature-hash>/ and open
 * a PR to seoranko-com. Never auto-merges.
 */

import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'
import type { FixFailureEvidence } from './evidence'
import type { FixFailureStage } from './signature'

const OWNER = 'kamrangul87'
const REPO = 'seoranko-com'
const GH = 'https://api.github.com'

function headers(token: string) {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
    'User-Agent': 'seoranko-failure-learning',
  }
}

async function ghJson<T>(
  token: string,
  path: string,
  init?: RequestInit,
): Promise<{ ok: boolean; status: number; data: T; text: string }> {
  const res = await fetch(`${GH}${path}`, {
    ...init,
    headers: { ...headers(token), ...(init?.headers || {}) },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  let data = {} as T
  try {
    data = text ? (JSON.parse(text) as T) : ({} as T)
  } catch {
    /* */
  }
  return { ok: res.ok, status: res.status, data, text }
}

export function buildFixtureCaseFiles(input: {
  signature: string
  signatureHash: string
  topic: string
  verdict: string
  stage: FixFailureStage
  evidence: FixFailureEvidence
}): { path: string; content: string }[] {
  const dir = `fixtures/failure-cases/${input.signatureHash}`
  const snippet = input.evidence.snippet || '<!-- no snippet -->'
  const expected = {
    topicId: input.topic,
    verdict: input.verdict,
    stage: input.stage,
    signature: input.signature,
    pageUrl: null,
    notes:
      'Draft fixture from Fix Agent failure ledger. Sanitised tag-level HTML only.',
  }
  return [
    {
      path: `${dir}/snippet.html`,
      content: `${snippet}\n`,
    },
    {
      path: `${dir}/expected.json`,
      content: `${JSON.stringify(expected, null, 2)}\n`,
    },
    {
      path: `${dir}/README.md`,
      content: [
        `# Failure case \`${input.signatureHash}\``,
        '',
        `- Topic: ${input.topic}`,
        `- Verdict: ${input.verdict}`,
        `- Stage: ${input.stage}`,
        `- Signature: \`${input.signature}\``,
        '',
        'Auto-drafted from the failure ledger. Do not auto-merge.',
        '',
      ].join('\n'),
    },
  ]
}

export async function openFixtureCasePr(input: {
  signature: string
  signatureHash: string
  topic: string
  verdict: string
  stage: FixFailureStage
  evidence: FixFailureEvidence
  /** Master user id for installation lookup; optional. */
  userId?: string | null
}): Promise<{ ok: true; prUrl: string } | { ok: false; error: string }> {
  try {
    const creds = await resolveGithubAppRepoCreds({
      owner: OWNER,
      repo: REPO,
      userId: input.userId ?? undefined,
    })
    if (!creds?.accessToken) {
      return { ok: false, error: 'GitHub App credentials unavailable for seoranko-com' }
    }
    const token = creds.accessToken
    const base = creds.baseBranch || 'main'

    // Skip if folder already exists on base
    const existing = await ghJson<{ sha?: string }>(
      token,
      `/repos/${OWNER}/${REPO}/contents/fixtures/failure-cases/${input.signatureHash}/expected.json?ref=${encodeURIComponent(base)}`,
    )
    if (existing.ok) {
      return { ok: false, error: 'Fixture case already exists on base' }
    }

    const branch = `cursor/failure-case-${input.signatureHash}`
    const refRes = await ghJson<{ object?: { sha?: string } }>(
      token,
      `/repos/${OWNER}/${REPO}/git/ref/heads/${encodeURIComponent(base)}`,
    )
    const baseSha = refRes.data.object?.sha
    if (!refRes.ok || !baseSha) {
      return { ok: false, error: `Cannot resolve ${base} tip` }
    }

    await ghJson(token, `/repos/${OWNER}/${REPO}/git/refs`, {
      method: 'POST',
      body: JSON.stringify({
        ref: `refs/heads/${branch}`,
        sha: baseSha,
      }),
    })

    const files = buildFixtureCaseFiles(input)
    for (const f of files) {
      const put = await ghJson(
        token,
        `/repos/${OWNER}/${REPO}/contents/${f.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        {
          method: 'PUT',
          body: JSON.stringify({
            message: `test(failure-case): draft ${input.signatureHash} (${input.topic}/${input.verdict})`,
            content: Buffer.from(f.content, 'utf8').toString('base64'),
            branch,
          }),
        },
      )
      if (!put.ok) {
        return {
          ok: false,
          error: `Failed to write ${f.path}: ${put.text.slice(0, 200)}`,
        }
      }
    }

    const pr = await ghJson<{ html_url?: string }>(
      token,
      `/repos/${OWNER}/${REPO}/pulls`,
      {
        method: 'POST',
        body: JSON.stringify({
          title: `test(failure-case): ${input.topic}/${input.verdict} @ ${input.stage}`,
          head: branch,
          base,
          draft: true,
          body: [
            '## Summary',
            `Draft fixture for failure signature \`${input.signatureHash}\`.`,
            '',
            `- Topic: ${input.topic}`,
            `- Verdict: ${input.verdict}`,
            `- Stage: ${input.stage}`,
            '',
            'Do **not** auto-merge. Review the sanitised snippet before landing.',
          ].join('\n'),
        }),
      },
    )
    if (!pr.ok || !pr.data.html_url) {
      return { ok: false, error: `PR create failed: ${pr.text.slice(0, 200)}` }
    }
    return { ok: true, prUrl: pr.data.html_url }
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : 'openFixtureCasePr failed',
    }
  }
}
