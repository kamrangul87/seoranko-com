/**
 * Master-only: push selected fixture HTML files to kamrangul87/seoranko-fixture
 * `seed` branch so e2e expected.json stays in sync with the live seed tip.
 *
 * Auth: Authorization: Bearer $CRON_SECRET  OR  signed-in MASTER_EMAIL session.
 */

import { NextRequest, NextResponse } from 'next/server'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { requireCronSecret } from '@/lib/cron-auth'
import { createClient } from '@supabase/supabase-js'
import { resolveGithubAppRepoCreds } from '@/lib/github-app/resolve-repo-creds'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const OWNER = 'kamrangul87'
const REPO = 'seoranko-fixture'
const BRANCH = 'seed'

const FILES = ['index.html', 'about.html'] as const

async function assertMasterOrCron(req: NextRequest): Promise<Response | null> {
  const denied = requireCronSecret(req)
  if (!denied) return null
  // Fall through to master session
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  const master = process.env.MASTER_EMAIL?.trim().toLowerCase()
  if (!url || !anon || !master) return denied
  const auth = req.headers.get('authorization') || ''
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : ''
  if (!token || token === process.env.CRON_SECRET) return denied
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
  })
  const { data } = await sb.auth.getUser()
  if (data.user?.email?.toLowerCase() === master) return null
  return denied
}

async function masterUserId(): Promise<string> {
  const email = process.env.MASTER_EMAIL?.trim()
  if (!email) throw new Error('MASTER_EMAIL not configured')
  const sb = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
  const { data, error } = await sb.auth.admin.listUsers({ perPage: 200 })
  if (error) throw error
  const u = data.users.find(
    (x) => x.email?.toLowerCase() === email.toLowerCase(),
  )
  if (!u) throw new Error('Master user not found')
  return u.id
}

export async function POST(req: NextRequest) {
  const denied = await assertMasterOrCron(req)
  if (denied) return denied

  try {
    const userId = await masterUserId()
    const app = await resolveGithubAppRepoCreds({
      owner: OWNER,
      repo: REPO,
      userId,
    })
    if (!app?.accessToken) {
      return NextResponse.json(
        { ok: false, error: 'GitHub App credentials unavailable' },
        { status: 503 },
      )
    }
    const token = app.accessToken
    const root = join(process.cwd(), 'fixtures/seoranko-fixture-site')
    const commits: string[] = []

    for (const file of FILES) {
      const content = readFileSync(join(root, file), 'utf8')
      const metaRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${file}?ref=${BRANCH}`,
        {
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
          },
        },
      )
      const meta = (await metaRes.json()) as { sha?: string }
      const putRes = await fetch(
        `https://api.github.com/repos/${OWNER}/${REPO}/contents/${file}`,
        {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token}`,
            Accept: 'application/vnd.github+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            message: `seed(topic-74): sync ${file} from monorepo fixture`,
            content: Buffer.from(content, 'utf8').toString('base64'),
            branch: BRANCH,
            ...(meta.sha ? { sha: meta.sha } : {}),
          }),
        },
      )
      const body = (await putRes.json()) as {
        commit?: { sha?: string }
        message?: string
      }
      if (!putRes.ok) {
        return NextResponse.json(
          { ok: false, error: body.message || `failed to put ${file}` },
          { status: 502 },
        )
      }
      if (body.commit?.sha) commits.push(body.commit.sha)
    }

    const tipRes = await fetch(
      `https://api.github.com/repos/${OWNER}/${REPO}/branches/${BRANCH}`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/vnd.github+json',
        },
      },
    )
    const tip = (await tipRes.json()) as { commit?: { sha?: string } }
    const seedSha = tip.commit?.sha || commits[commits.length - 1] || null

    return NextResponse.json({
      ok: true,
      seedSha,
      seedUrl: seedSha
        ? `https://github.com/${OWNER}/${REPO}/commit/${seedSha}`
        : null,
      commits,
    })
  } catch (err) {
    console.error('[admin/fixture-seed-push]', err)
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : 'push failed' },
      { status: 500 },
    )
  }
}
