import { NextRequest } from 'next/server'
import { parseRobotsForAIBots } from '@/lib/robots-checker'

export async function POST(req: NextRequest) {
  try {
    const { domain } = await req.json()
    if (!domain) {
      return new Response(JSON.stringify({ error: 'domain is required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' }
      })
    }

    const cleanDomain = domain.replace(/^https?:\/\//, '').replace(/\/.*$/, '')
    const robotsUrl = `https://${cleanDomain}/robots.txt`

    let robotsContent = ''
    let found = false

    try {
      const res = await fetch(robotsUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; SEORANKO/1.0)' },
        signal: AbortSignal.timeout(8000),
      })
      if (res.ok) {
        robotsContent = await res.text()
        found = true
      }
    } catch {
      // Could not fetch robots.txt
    }

    if (!found) {
      return new Response(JSON.stringify({
        domain: cleanDomain,
        robotsTxtFound: false,
        results: [],
        allAllowed: true,
        blockedCount: 0,
        recommendedAddition: '',
        error: 'robots.txt not found or could not be fetched'
      }), { headers: { 'Content-Type': 'application/json' } })
    }

    const result = parseRobotsForAIBots(robotsContent, cleanDomain)
    return new Response(JSON.stringify(result), {
      headers: { 'Content-Type': 'application/json' }
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error'
    return new Response(JSON.stringify({ error: message }), {
      status: 500, headers: { 'Content-Type': 'application/json' }
    })
  }
}
