/**
 * Apply /blog/index.html → /blog/ redirect to kamrangul87/autodun-ai vercel.json.
 * Requires GITHUB_TOKEN with Contents:write on that repo.
 *
 * Run: GITHUB_TOKEN=ghp_... npx tsx scripts/push-autodun-canonical-redirect.ts
 */
import { mergeVercelJsonRedirect } from '../src/lib/fix-agent-redirect'

const OWNER = 'kamrangul87'
const REPO = 'autodun-ai'
const BRANCH = 'main'
const PATH = 'vercel.json'
const FROM = 'https://autodun.com/blog/index.html'
const TO = 'https://autodun.com/blog/'

async function main() {
  const token = process.env.GITHUB_TOKEN
  if (!token) {
    console.error('GITHUB_TOKEN is required (fine-grained PAT with Contents:write on autodun-ai).')
    process.exit(1)
  }

  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  }

  const getRes = await fetch(
    `https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}?ref=${BRANCH}`,
    { headers, signal: AbortSignal.timeout(20000) },
  )
  if (!getRes.ok) {
    console.error('Could not read vercel.json:', getRes.status, await getRes.text())
    process.exit(1)
  }
  const file = (await getRes.json()) as { content: string; sha: string }
  const current = Buffer.from(file.content, 'base64').toString('utf-8')
  const merged = mergeVercelJsonRedirect(current, FROM, TO)
  if (!merged.changed) {
    console.log('No change needed:', merged.summary)
    return
  }

  const putRes = await fetch(`https://api.github.com/repos/${OWNER}/${REPO}/contents/${PATH}`, {
    method: 'PUT',
    headers,
    body: JSON.stringify({
      message: 'fix(seo): 301 redirect /blog/index.html to /blog/ (SEORANKO Fix Agent)',
      content: Buffer.from(merged.content, 'utf-8').toString('base64'),
      sha: file.sha,
      branch: BRANCH,
    }),
    signal: AbortSignal.timeout(20000),
  })
  if (!putRes.ok) {
    console.error('GitHub write failed:', putRes.status, await putRes.text())
    process.exit(1)
  }
  const data = (await putRes.json()) as { commit: { sha: string; html_url: string } }
  console.log('Committed:', data.commit.sha, data.commit.html_url)
  console.log(merged.summary)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
