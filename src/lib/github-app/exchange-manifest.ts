/**
 * Exchange GitHub App manifest temporary code for app credentials.
 * Server-side only — response includes PEM + secrets.
 */

import 'server-only'

export type ManifestConversionResult = {
  id: number
  slug: string
  client_id: string
  client_secret: string
  webhook_secret: string
  pem: string
  html_url?: string
  name?: string
}

export async function exchangeManifestCode(code: string): Promise<ManifestConversionResult> {
  const res = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: 'POST',
    headers: {
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
    signal: AbortSignal.timeout(30_000),
  })
  const text = await res.text()
  if (res.status !== 201) {
    throw new Error(`Manifest conversion failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const data = JSON.parse(text) as ManifestConversionResult
  if (!data.id || !data.pem || !data.client_secret || !data.webhook_secret || !data.client_id) {
    throw new Error('Manifest conversion response missing required fields')
  }
  return data
}
