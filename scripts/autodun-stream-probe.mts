import { fetchUrl } from '../src/lib/fix-strategies/fetch/fetch-url'
import { FETCH_EVIDENCE_CONFIG } from '../src/lib/fix-strategies/fetch/config'

async function main() {
  const deps = {
    fetch: globalThis.fetch,
    sleep: async () => {},
    now: () => Date.now(),
    config: { ...FETCH_EVIDENCE_CONFIG, timeoutMs: 20_000 },
  }

  function words(html: string) {
    const text = html
      .replace(/<script[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
    return text ? text.split(' ').filter(Boolean).length : 0
  }

  const outcome = await fetchUrl('https://autodun.com/', deps)
  const body = outcome.kind === 'http' ? outcome.body : ''
  console.log(
    JSON.stringify(
      {
        kind: outcome.kind,
        status: outcome.kind === 'http' ? outcome.status : undefined,
        streamComplete: outcome.streamComplete,
        bytes: body.length,
        words: words(body),
        hasAnchors: /<a\s[^>]*href=/i.test(body),
        title: body.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? null,
        error: outcome.kind !== 'http' ? outcome.error : undefined,
        snippet: body.slice(0, 500).replace(/\s+/g, ' '),
      },
      null,
      2,
    ),
  )
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
