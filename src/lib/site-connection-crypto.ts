/**
 * Encrypt site-connection credentials at rest (AES-256-GCM).
 * Key: SITE_CONNECTION_ENCRYPTION_KEY (32+ byte secret) or a SHA-256
 * derivation of SUPABASE_SERVICE_ROLE_KEY as fallback (logged once).
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto'

const PREFIX = 'enc:v1:'

function getKey(): Buffer {
  const raw = process.env.SITE_CONNECTION_ENCRYPTION_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!raw) {
    throw new Error('SITE_CONNECTION_ENCRYPTION_KEY (or SUPABASE_SERVICE_ROLE_KEY) is required to store site credentials')
  }
  return createHash('sha256').update(raw).digest()
}

export function encryptCredentialsJson(payload: Record<string, unknown>): string {
  const key = getKey()
  const iv = randomBytes(12)
  const cipher = createCipheriv('aes-256-gcm', key, iv)
  const plaintext = Buffer.from(JSON.stringify(payload), 'utf8')
  const encrypted = Buffer.concat([cipher.update(plaintext), cipher.final()])
  const tag = cipher.getAuthTag()
  return PREFIX + Buffer.concat([iv, tag, encrypted]).toString('base64url')
}

export function decryptCredentialsJson(ciphertext: string): Record<string, unknown> {
  if (!ciphertext.startsWith(PREFIX)) {
    // Legacy plaintext JSON string accidentally stored
    try {
      return JSON.parse(ciphertext)
    } catch {
      throw new Error('Unrecognized credential ciphertext')
    }
  }
  const key = getKey()
  const buf = Buffer.from(ciphertext.slice(PREFIX.length), 'base64url')
  const iv = buf.subarray(0, 12)
  const tag = buf.subarray(12, 28)
  const data = buf.subarray(28)
  const decipher = createDecipheriv('aes-256-gcm', key, iv)
  decipher.setAuthTag(tag)
  const plain = Buffer.concat([decipher.update(data), decipher.final()]).toString('utf8')
  return JSON.parse(plain)
}

export function isEncryptedCredentialsBlob(value: unknown): value is string {
  return typeof value === 'string' && value.startsWith(PREFIX)
}

/**
 * Read credentials from a site_connections row — prefers encrypted column,
 * falls back to legacy JSONB / WP columns.
 */
export function loadConnectionCredentials(row: {
  credentials?: unknown
  credentials_ciphertext?: string | null
  wp_username?: string | null
  wp_app_password?: string | null
  cms_type?: string | null
}): Record<string, string> {
  if (row.credentials_ciphertext) {
    const decrypted = decryptCredentialsJson(row.credentials_ciphertext)
    return Object.fromEntries(
      Object.entries(decrypted).map(([k, v]) => [k, v == null ? '' : String(v)]),
    )
  }

  if (row.credentials && typeof row.credentials === 'object' && !Array.isArray(row.credentials)) {
    const obj = row.credentials as Record<string, unknown>
    // Already wrapped as encrypted string inside JSONB
    if (typeof obj.__ciphertext === 'string') {
      return loadConnectionCredentials({ credentials_ciphertext: obj.__ciphertext })
    }
    return Object.fromEntries(
      Object.entries(obj).map(([k, v]) => [k, v == null ? '' : String(v)]),
    )
  }

  if (row.cms_type === 'wordpress' || row.wp_app_password) {
    return {
      username: row.wp_username || '',
      appPassword: row.wp_app_password || '',
    }
  }

  return {}
}
