/**
 * GET /api/github/app/manifest/start
 * Owner-only: mint a fresh CSRF state and immediately auto-POST the App
 * Manifest to GitHub (10-minute window). Avoids minting state on page load.
 */

import { NextResponse } from 'next/server'
import { requireMasterUser } from '@/lib/github-app/require-master'
import { buildSeorankoGithubAppManifest } from '@/lib/github-app/manifest'
import { getGithubAppPublicMeta } from '@/lib/github-app/store'
import { mintManifestState } from '@/lib/github-app/state'
import { GITHUB_APP_URLS } from '@/lib/github-app/urls'

export const dynamic = 'force-dynamic'

function escapeHtmlAttr(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export async function GET() {
  const master = await requireMasterUser()
  if (!master.ok) {
    if (master.status === 401) {
      return NextResponse.redirect(
        new URL(
          `/login?next=${encodeURIComponent(GITHUB_APP_URLS.adminSetupPage)}`,
          GITHUB_APP_URLS.homepage,
        ),
      )
    }
    return new NextResponse('Forbidden — owner account only.', { status: 403 })
  }

  const existing = await getGithubAppPublicMeta()
  if (existing) {
    return NextResponse.redirect(
      new URL(`${GITHUB_APP_URLS.adminSetupPage}?already=1`, GITHUB_APP_URLS.homepage),
    )
  }

  const state = mintManifestState()
  const manifestJson = JSON.stringify(buildSeorankoGithubAppManifest())
  const action = `https://github.com/settings/apps/new?state=${encodeURIComponent(state)}`

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <title>Redirecting to GitHub…</title>
</head>
<body>
  <p>Redirecting to GitHub App Manifest…</p>
  <form id="f" action="${escapeHtmlAttr(action)}" method="post">
    <input type="hidden" name="manifest" value="${escapeHtmlAttr(manifestJson)}"/>
    <noscript><button type="submit">Continue to GitHub</button></noscript>
  </form>
  <script>document.getElementById('f').submit()</script>
</body>
</html>`

  return new NextResponse(html, {
    status: 200,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  })
}
