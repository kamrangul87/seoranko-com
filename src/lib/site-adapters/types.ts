// src/lib/site-adapters/types.ts
// Every platform adapter implements this contract. RANKO's fix logic only ever
// talks to this interface — never a platform-specific API directly.

export interface SiteCredentials {
  siteUrl: string
  /** connected_sites.id — needed by adapters that write to our own DB. */
  siteId?: string
  [key: string]: string | undefined
}

export interface PageContent {
  id: string           // platform-specific page/post identifier
  url: string          // live public URL
  title: string
  bodyHtml: string
  hasSchema: boolean
  /** Field name the body came from — some platforms need it to write back. */
  bodyField?: string
}

export interface FixApplyResult {
  success: boolean
  error?: string
  /** Fix was already present; nothing was written. */
  skipped?: boolean
}

export interface CMSAdapter {
  platform: string

  /**
   * Can fixes be confirmed by re-fetching the live page server-side?
   * False for JS-injected approaches (Universal Tag) — a plain fetch will
   * never see DOM-injected schema, so claiming "unverified" would be
   * misleading rather than informative.
   */
  serverVerifiable: boolean

  verifyConnection(creds: SiteCredentials): Promise<{ success: boolean; detail?: string; error?: string }>

  findPageContent(creds: SiteCredentials, url: string): Promise<PageContent | null>

  injectSchema(creds: SiteCredentials, page: PageContent, schemaJsonLd: Record<string, unknown>): Promise<FixApplyResult>

  appendContent(creds: SiteCredentials, page: PageContent, html: string, position: 'start' | 'end'): Promise<FixApplyResult>
}

/** Shared idempotency check — don't append a second block of the same @type. */
export function alreadyHasSchemaType(bodyHtml: string, schemaJsonLd: Record<string, unknown>): boolean {
  const type = String(schemaJsonLd['@type'] || '')
  if (!type) return false
  return new RegExp(`"@type"\\s*:\\s*"${type}"`, 'i').test(bodyHtml)
}

export function schemaScriptTag(schemaJsonLd: Record<string, unknown>): string {
  return `\n<script type="application/ld+json">${JSON.stringify(schemaJsonLd)}</script>\n`
}
