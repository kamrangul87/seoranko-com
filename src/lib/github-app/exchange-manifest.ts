/**
 * Exchange GitHub App manifest temporary code for app credentials.
 * Server-side only — response includes PEM + secrets.
 */

import 'server-only'

export type ManifestConversionOwner = {
  login: string
  type: string
  id?: number
}

export type ManifestConversionResult = {
  id: number
  slug: string
  client_id: string
  client_secret: string
  webhook_secret: string
  pem: string
  html_url?: string
  name?: string
  owner?: ManifestConversionOwner | null
  /** Top-level keys present on the conversion JSON (including secret field names). */
  fieldNames: string[]
  /** Full parsed conversion object — caller must not log/persist secret values. */
  raw: Record<string, unknown>
  convertedAt: string
}

export async function exchangeManifestCode(code: string): Promise<ManifestConversionResult> {
  const convertedAt = new Date().toISOString()
  const res = await fetch(
    `https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    },
  )
  const text = await res.text()
  if (res.status !== 201) {
    throw new Error(`Manifest conversion failed (${res.status}): ${text.slice(0, 300)}`)
  }
  const data = JSON.parse(text) as Record<string, unknown>
  const fieldNames = Object.keys(data).sort()
  const ownerRaw = data.owner as
    | { login?: string; type?: string; id?: number }
    | null
    | undefined
  const owner =
    ownerRaw && ownerRaw.login
      ? {
          login: String(ownerRaw.login),
          type: String(ownerRaw.type || 'User'),
          id: ownerRaw.id != null ? Number(ownerRaw.id) : undefined,
        }
      : null

  const id = Number(data.id)
  const pem = String(data.pem || '')
  const client_secret = String(data.client_secret || '')
  const webhook_secret = String(data.webhook_secret || '')
  const client_id = String(data.client_id || '')
  if (!id || !pem || !client_secret || !webhook_secret || !client_id) {
    throw new Error('Manifest conversion response missing required fields')
  }

  return {
    id,
    slug: String(data.slug || data.name || 'SEORANKO'),
    client_id,
    client_secret,
    webhook_secret,
    pem,
    html_url: data.html_url ? String(data.html_url) : undefined,
    name: data.name ? String(data.name) : undefined,
    owner,
    fieldNames,
    raw: data,
    convertedAt,
  }
}

/** Non-secret forensic snapshot of a conversion response. */
export function conversionMetaWithoutSecrets(
  converted: ManifestConversionResult,
): Record<string, unknown> {
  const owner = converted.owner
  return {
    id: converted.id,
    slug: converted.slug,
    name: converted.name ?? null,
    client_id: converted.client_id,
    html_url: converted.html_url ?? null,
    owner_login: owner?.login ?? null,
    owner_type: owner?.type ?? null,
    owner_id: owner?.id ?? null,
    field_names: converted.fieldNames,
    converted_at: converted.convertedAt,
    // Note which secret-bearing keys were present without storing values.
    secret_fields_present: converted.fieldNames.filter((k) =>
      /secret|pem|private|token|password/i.test(k),
    ),
  }
}
