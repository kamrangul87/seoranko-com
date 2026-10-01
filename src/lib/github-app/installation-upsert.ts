/**
 * Pure helpers for github_installations upsert shape.
 * Kept free of `server-only` so unit tests can lock the user_id preserve contract.
 */

export type UpsertInstallationInput = {
  installationId: number
  accountLogin: string
  accountType: string
  accountId?: number | null
  /**
   * Omit to leave an existing `user_id` untouched (webhooks / App API sync must
   * not wipe the SEORANKO↔installation link). Pass a string to link; pass
   * `null` only when intentionally unlinking.
   */
  userId?: string | null
  repositorySelection?: string | null
  suspendedAt?: string | null
  uninstalledAt?: string | null
  raw?: unknown
}

/**
 * Build the github_installations upsert row.
 * When `userId` is omitted, the column is left out of the payload so Postgres
 * ON CONFLICT UPDATE does not null an existing link.
 */
export function buildGithubInstallationUpsertRow(
  row: UpsertInstallationInput,
  updatedAt: string = new Date().toISOString(),
): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    installation_id: row.installationId,
    account_login: row.accountLogin,
    account_type: row.accountType,
    account_id: row.accountId ?? null,
    repository_selection: row.repositorySelection ?? null,
    suspended_at: row.suspendedAt ?? null,
    uninstalled_at: row.uninstalledAt ?? null,
    raw: row.raw ?? null,
    updated_at: updatedAt,
  }
  if (Object.prototype.hasOwnProperty.call(row, 'userId')) {
    payload.user_id = row.userId ?? null
  }
  return payload
}
