/**
 * Production live verify for topic 49 on autodun MOT advisories page.
 * Run: npx tsx scripts/verify-prod-topic49.ts
 */
import { verifyLiveImgDimensions } from '../src/lib/fix-strategies/topic-49/verify-live-dimensions'
import { verifyFindingLive } from '../src/lib/fix-strategies/findings-ui/fix-flow/verify-live'

const PAGE_URL =
  process.env.FINDINGS_VERIFY_URL ||
  'https://autodun.com/blog/mot-advisories-explained-uk.html'

async function main() {
  const res = await fetch(PAGE_URL, {
    headers: {
      'User-Agent': 'SEORANKO-Findings-Verifier/1.0',
      'Cache-Control': 'no-cache',
    },
    redirect: 'follow',
    signal: AbortSignal.timeout(30000),
  })
  if (!res.ok) {
    console.error('HTTP', res.status)
    process.exit(1)
  }
  const html = await res.text()

  const imgTags = [...html.matchAll(/<img\b[^>]*>/gi)].map((m) => m[0])
  const dims = imgTags.map((tag) => {
    const w = tag.match(/width="([^"]*)"/i)?.[1] ?? null
    const h = tag.match(/height="([^"]*)"/i)?.[1] ?? null
    const src = tag.match(/src="([^"]*)"/i)?.[1] ?? ''
    return { src, width: w, height: h }
  })
  console.log(JSON.stringify({ pageUrl: PAGE_URL, imgCount: dims.length, dims }, null, 2))

  const all1200x675 = dims.every((d) => d.width === '1200' && d.height === '675')
  console.log('all_width_1200_height_675', all1200x675)

  const direct = await verifyLiveImgDimensions(html, PAGE_URL, fetch)
  console.log('direct', JSON.stringify(direct))

  const viaFlow = await verifyFindingLive({ topicId: '49', liveUrl: PAGE_URL })
  console.log('viaFlow', JSON.stringify(viaFlow))

  if (!all1200x675 || !direct.ok || !viaFlow.ok) process.exit(2)
  console.log('PRODUCTION_VERIFY_OK')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
