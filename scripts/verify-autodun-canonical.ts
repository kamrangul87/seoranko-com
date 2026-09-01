/**
 * Live Index Diagnosis check for autodun.com canonical /blog/index.html issue.
 * Run: npx tsx scripts/verify-autodun-canonical.ts
 */
import { runIndexDiagnosis } from '../src/lib/index-diagnosis/run'
import { buildIndexDiagnosisFixAgentIssues } from '../src/lib/index-diagnosis/fix-agent-issues'
import { verifyRedirectLive } from '../src/lib/fix-agent-redirect'

async function main() {
  const fromUrl = 'https://autodun.com/blog/index.html'
  const toPath = '/blog/'

  const headRes = await fetch(fromUrl, {
    redirect: 'manual',
    headers: { 'User-Agent': 'SEORANKO-Verify/1.0' },
    signal: AbortSignal.timeout(15000),
  })
  const redirectLive = headRes.status >= 300 && headRes.status < 400
  const redirectCheck = await verifyRedirectLive(fromUrl, toPath)

  const result = await runIndexDiagnosis('https://autodun.com/')
  const canonIssues = buildIndexDiagnosisFixAgentIssues(result, null).filter((i) =>
    i.id.includes('canonical'),
  )
  const indexHtmlPages = result.pages.filter((p) => /index\.html/i.test(p.url))
  const atRiskCanon = result.pages.filter(
    (p) => p.verdict === 'AT_RISK' && p.steps.some((s) => s.step === 'canonical' && !s.passed),
  )

  console.log(
    JSON.stringify(
      {
        liveRedirect: {
          httpStatus: headRes.status,
          location: headRes.headers.get('location'),
          redirectLive,
          verifyRedirectLive: redirectCheck,
        },
        canonicalFixIssues: canonIssues.map((i) => ({ id: i.id, title: i.title })),
        indexHtmlPages: indexHtmlPages.map((p) => ({
          url: p.url,
          verdict: p.verdict,
          canonicalEvidence: p.steps.find((s) => s.step === 'canonical')?.evidence,
        })),
        atRiskCanonical: atRiskCanon.map((p) => ({ url: p.url, evidence: p.decisiveEvidence })),
        followUpCanonical: result.followUpTasks.filter((t) => t.id.includes('canonical')),
        resolved: canonIssues.length === 0 && atRiskCanon.length === 0,
      },
      null,
      2,
    ),
  )
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
