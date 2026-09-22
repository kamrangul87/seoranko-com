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

export type GithubAppPublicMeta = {
  appId: number
  slug: string
  clientId: string
  htmlUrl: string | null
  createdAt: string
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
    .select('app_id, slug, client_id, html_url, created_at')
    .maybeSingle()
  if (error) throw new Error(`github_app_config read failed: ${error.message}`)
  if (!data) return null
  return {
    appId: Number(data.app_id),
    slug: String(data.slug),
    clientId: String(data.client_id),
    htmlUrl: data.html_url ? String(data.html_url) : null,
    createdAt: String(data.created_at),
  }
}

export async function loadGithubAppRecord(): Promise<GithubAppRecord | null> {
  const supabase = createServiceRoleClient()
  const { data, error } = await supabase
    .from('github_app_config')
    .select('app_id, slug, client_id, credentials_ciphertext, html_url, created_at')
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
    ...secrets,
  }
}

export async function saveGithubAppFromManifest(input: {
  appId: number
  slug: string
  clientId: string
  htmlUrl?: string | null
  privateKeyPem: string
  clientSecret: string
  webhookSecret: string
  createdByUserId: string
}): Promise<GithubAppPublicMeta> {
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
    })
    .select('app_id, slug, client_id, html_url, created_at')
    .single()

  if (error) throw new Error(`github_app_config insert failed: ${error.message}`)
  return {
    appId: Number(data.app_id),
    slug: String(data.slug),
    clientId: String(data.client_id),
    htmlUrl: data.html_url ? String(data.html_url) : null,
    createdAt: String(data.created_at),
  }
}

export async function upsertInstallation(row: {
  installationId: number
  accountLogin: string
  accountType: string
  accountId?: number | null
  userId?: string | null
  repositorySelection?: string | null
  suspendedAt?: string | null
  uninstalledAt?: string | null
  raw?: unknown
}): Promise<void> {
  const supabase = createServiceRoleClient()
  const { error } = await supabase.from('github_installations').upsert(
    {
      installation_id: row.installationId,
      account_login: row.accountLogin,
      account_type: row.accountType,
      account_id: row.accountId ?? null,
      user_id: row.userId ?? null,
      repository_selection: row.repositorySelection ?? null,
      suspended_at: row.suspendedAt ?? null,
      uninstalled_at: row.uninstalledAt ?? null,
      raw: row.raw ?? null,
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'installation_id' },
  )
  if (error) throw new Error(`github_installations upsert failed: ${error.message}`)
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
