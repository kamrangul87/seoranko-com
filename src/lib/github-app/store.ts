/**
 * Persist / load the product GitHub App config. Server-only.
 * Never return private_key_pem / client_secret / webhook_secret to the browser.
 */

import 'server-only'
import {
  decryptCredentialsJson,
  encryptCredentialsJson,
} from '@/lib/site-connection-crypto'
import { createServiceRoleClient } from '@/lib/supabase/service-role'
import {
  buildGithubInstallationUpsertRow,
  type UpsertInstallationInput,
} from '@/lib/github-app/installation-upsert'

export { buildGithubInstallationUpsertRow, type UpsertInstallationInput } from '@/lib/github-app/installation-upsert'

export type GithubAppPublicMeta = {
  appId: number
  slug: string
  clientId: string
  htmlUrl: string | null
  createdAt: string
  ownerLogin: string | null
  ownerType: string | null
}

export type GithubAppSecrets = {
  privateKeyPem: string
  clientSecret: string
  webhookSecret: string
}

export type GithubAppRecord = GithubAppPublicMeta & GithubAppSecrets

type ConfigRow = {
  app_id: number
  slug: string
  client_id: string
  credentials_ciphertext: string
  html_url: string | null
  created_at: string
  owner_login?: string | null
  owner_type?: string | null
}

function parseSecrets(ciphertext: string): GithubAppSecrets {
  const raw = decryptCredentialsJson(ciphertext)
  const privateKeyPem = String(raw.private_key_pem ?? '')
  const clientSecret = String(raw.client_secret ?? '')
  const webhookSecret = String(raw.webhook_secret ?? '')
  if (!privateKeyPem || !clientSecret || !webhookSecret) {
    throw new Error('github_app_config ciphertext missing required secret fields')
  }
  return { privateKeyPem, clientSecret, webhookSecret }
}

export async function getGithubAppPublicMeta(): Promise<GithubAppPublicMeta | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('github_app_config')
    .select('app_id, slug, client_id, html_url, created_at, owner_login, owner_type')
    .maybeSingle()
  if (error) throw new Error(`github_app_config read failed: ${error.message}`)
  if (!data) return null
  return {
    appId: Number(data.app_id),
    slug: String(data.slug),
    clientId: String(data.client_id),
    htmlUrl: data.html_url ? String(data.html_url) : null,
    createdAt: String(data.created_at),
    ownerLogin: data.owner_login ? String(data.owner_login) : null,
    ownerType: data.owner_type ? String(data.owner_type) : null,
  }
}

export async function loadGithubAppRecord(): Promise<GithubAppRecord | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('github_app_config')
    .select(
      'app_id, slug, client_id, credentials_ciphertext, html_url, created_at, owner_login, owner_type',
    )
    .maybeSingle()
  if (error) throw new Error(`github_app_config read failed: ${error.message}`)
  if (!data) return null
  const row = data as ConfigRow
  const secrets = parseSecrets(row.credentials_ciphertext)
  return {
    appId: Number(row.app_id),
    slug: String(row.slug),
    clientId: String(row.client_id),
    htmlUrl: row.html_url ? String(row.html_url) : null,
    createdAt: String(row.created_at),
    ownerLogin: row.owner_login ? String(row.owner_login) : null,
    ownerType: row.owner_type ? String(row.owner_type) : null,
    ...secrets,
  }
}

export type SaveGithubAppCredentialsInput = {
  appId: number
  slug: string
  clientId: string
  htmlUrl?: string | null
  privateKeyPem: string
  clientSecret: string
  webhookSecret: string
  createdByUserId: string
  ownerLogin?: string | null
  ownerType?: string | null
  ownerId?: number | null
  conversionAt?: string | null
  conversionFieldNames?: string[] | null
  conversionResponseMeta?: Record<string, unknown> | null
}

/**
 * Persist verified App credentials. Caller MUST have proven GET /app = 200
 * before invoking — never write a row for an App GitHub does not recognize.
 */
export async function saveGithubAppCredentials(
  input: SaveGithubAppCredentialsInput,
): Promise<GithubAppPublicMeta> {
  const existing = await getGithubAppPublicMeta()
  if (existing) {
    throw new Error('GitHub App already registered — setup page is disabled')
  }

  const ciphertext = encryptCredentialsJson({
    private_key_pem: input.privateKeyPem,
    client_secret: input.clientSecret,
    webhook_secret: input.webhookSecret,
  })

  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('github_app_config')
    .insert({
      singleton: true,
      app_id: input.appId,
      slug: input.slug,
      client_id: input.clientId,
      credentials_ciphertext: ciphertext,
      html_url: input.htmlUrl ?? null,
      created_by_user_id: input.createdByUserId,
      owner_login: input.ownerLogin ?? null,
      owner_type: input.ownerType ?? null,
      owner_id: input.ownerId ?? null,
      conversion_at: input.conversionAt ?? null,
      conversion_field_names: input.conversionFieldNames ?? null,
      conversion_response_meta: input.conversionResponseMeta ?? null,
    })
    .select('app_id, slug, client_id, html_url, created_at, owner_login, owner_type')
    .single()

  if (error) throw new Error(`github_app_config insert failed: ${error.message}`)
  return {
    appId: Number(data.app_id),
    slug: String(data.slug),
    clientId: String(data.client_id),
    htmlUrl: data.html_url ? String(data.html_url) : null,
    createdAt: String(data.created_at),
    ownerLogin: data.owner_login ? String(data.owner_login) : null,
    ownerType: data.owner_type ? String(data.owner_type) : null,
  }
}

/** @deprecated Prefer saveGithubAppCredentials — same insert path. */
export async function saveGithubAppFromManifest(
  input: SaveGithubAppCredentialsInput & {
    conversionAt: string
    conversionFieldNames: string[]
    conversionResponseMeta: Record<string, unknown>
  },
): Promise<GithubAppPublicMeta> {
  return saveGithubAppCredentials(input)
}

export async function upsertInstallation(row: UpsertInstallationInput): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('github_installations')
    .upsert(buildGithubInstallationUpsertRow(row), { onConflict: 'installation_id' })
  if (error) throw new Error(`github_installations upsert failed: ${error.message}`)
}

export type GithubInstallationStatusRow = {
  installation_id: number
  account_login: string
  account_type: string
  repository_selection: string | null
  uninstalled_at: string | null
  suspended_at: string | null
}

/**
 * Installations linked to this SEORANKO user, plus orphans (user_id null) whose
 * GitHub account_login matches an owner on the user's active github site
 * connections — then backfill user_id so Settings stops saying "Not installed".
 */
export async function listInstallationsForUser(userId: string): Promise<GithubInstallationStatusRow[]> {
  const supabase = createServiceRoleClient()
  const { data: linked, error: linkedErr } = await supabase
    .from('github_installations')
    .select(
      'installation_id, account_login, account_type, repository_selection, uninstalled_at, suspended_at',
    )
    .eq('user_id', userId)
    .is('uninstalled_at', null)

  if (linkedErr) throw new Error(`github_installations read failed: ${linkedErr.message}`)

  const byId = new Map<number, GithubInstallationStatusRow>()
  for (const row of (linked || []) as GithubInstallationStatusRow[]) {
    byId.set(Number(row.installation_id), row)
  }

  const owners = await githubOwnersFromUserSiteConnections(userId)
  if (owners.size > 0) {
    const { data: orphans, error: orphanErr } = await supabase
      .from('github_installations')
      .select(
        'installation_id, account_login, account_type, repository_selection, uninstalled_at, suspended_at, user_id',
      )
      .is('uninstalled_at', null)
      .is('user_id', null)

    if (orphanErr) throw new Error(`github_installations orphan read failed: ${orphanErr.message}`)

    for (const row of orphans || []) {
      const login = String(row.account_login || '').toLowerCase()
      if (!owners.has(login)) continue
      const installationId = Number(row.installation_id)
      if (!Number.isFinite(installationId)) continue
      await supabase
        .from('github_installations')
        .update({ user_id: userId, updated_at: new Date().toISOString() })
        .eq('installation_id', installationId)
        .is('user_id', null)
      byId.set(installationId, {
        installation_id: installationId,
        account_login: row.account_login,
        account_type: row.account_type,
        repository_selection: row.repository_selection,
        uninstalled_at: row.uninstalled_at,
        suspended_at: row.suspended_at,
      })
    }
  }

  return Array.from(byId.values())
}

async function githubOwnersFromUserSiteConnections(userId: string): Promise<Set<string>> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('site_connections')
    .select('credentials, credentials_ciphertext')
    .eq('user_id', userId)
    .eq('cms_type', 'github')
    .eq('is_active', true)

  if (error || !data?.length) return new Set()

  const owners = new Set<string>()
  for (const row of data) {
    let creds: Record<string, unknown> = {}
    if (row.credentials && typeof row.credentials === 'object' && !Array.isArray(row.credentials)) {
      creds = row.credentials as Record<string, unknown>
    }
    if (typeof row.credentials_ciphertext === 'string' && row.credentials_ciphertext) {
      try {
        creds = { ...creds, ...decryptCredentialsJson(row.credentials_ciphertext) }
      } catch {
        // skip undecryptable rows
      }
    }
    const owner = typeof creds.owner === 'string' ? creds.owner.trim().toLowerCase() : ''
    if (owner) owners.add(owner)
  }
  return owners
}

export async function markInstallationUninstalled(installationId: number): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase
    .from('github_installations')
    .update({
      uninstalled_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq('installation_id', installationId)
  if (error) throw new Error(`github_installations uninstall update failed: ${error.message}`)
}
