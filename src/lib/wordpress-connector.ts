/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/wordpress-connector.ts
// WordPress Application Password authentication — built into WP core since 5.6,
// no plugin required. Standard Basic Auth against wp-json.
//
// IMPORTANT: all reads use `context=edit` so we get `content.raw` (the real
// post_content source, including Gutenberg block comments and shortcodes).
// `content.rendered` is the *output* HTML — writing that back as `content`
// would permanently flatten blocks and expand shortcodes, destroying the post.

import { isSafePublicUrl } from './fetch-page-content'

export interface WPConnection {
  siteUrl: string       // e.g. 'https://autodun.com'
  username: string
  appPassword: string   // format: 'xxxx xxxx xxxx xxxx xxxx xxxx'
}

export interface WPPost {
  id: number
  title: string
  /** Raw post_content source — safe to modify and write back. */
  content: string
  link: string
  status: string
  /** 'posts' | 'pages' — needed to build the right update endpoint. */
  type: 'posts' | 'pages'
}

function authHeader(conn: WPConnection): string {
  const token = Buffer.from(
    `${conn.username}:${conn.appPassword.replace(/\s/g, '')}`
  ).toString('base64')
  return `Basic ${token}`
}

/** Normalise to scheme + host, and refuse local-network targets. */
export function normaliseSiteUrl(input: string): string | null {
  const bare = input.replace(/^https?:\/\//, '').split('/')[0]
  const url = `https://${bare}`
  return isSafePublicUrl(url) ? url : null
}

export async function verifyConnection(conn: WPConnection): Promise<{
  success: boolean
  wpVersion?: string
  error?: string
}> {
  if (!isSafePublicUrl(conn.siteUrl)) {
    return { success: false, error: 'That site URL cannot be reached — only public https sites are supported.' }
  }
  try {
    // /wp-json/ is public; hitting an authenticated endpoint is what actually
    // proves the credentials work.
    const res = await fetch(`${conn.siteUrl}/wp-json/wp/v2/users/me?context=edit`, {
      headers: { Authorization: authHeader(conn) },
      signal: AbortSignal.timeout(15000)
    })

    if (res.status === 401 || res.status === 403) {
      return { success: false, error: 'WordPress rejected those credentials — check the username and Application Password.' }
    }
    if (!res.ok) {
      return { success: false, error: `Connection failed (${res.status}) — check the site URL and that the REST API is enabled.` }
    }

    const me = await res.json()
    // Writing requires edit_posts; a Subscriber account authenticates but
    // cannot apply any fix, so surface that now rather than at write time.
    const caps = me?.capabilities || {}
    if (caps && Object.keys(caps).length > 0 && !caps.edit_posts) {
      return { success: false, error: `Connected as "${me.name || conn.username}", but that account cannot edit posts. Use an Editor or Administrator account.` }
    }

    return { success: true, wpVersion: me?.name ? `Connected as ${me.name}` : 'WordPress' }
  } catch {
    return { success: false, error: 'Could not reach this site — check the URL is correct and the REST API is enabled.' }
  }
}

export async function detectSeoPlugin(conn: WPConnection): Promise<string | null> {
  try {
    const res = await fetch(`${conn.siteUrl}/wp-json/`, {
      headers: { Authorization: authHeader(conn) },
      signal: AbortSignal.timeout(15000)
    })
    if (!res.ok) return null
    const data = await res.json()
    const namespaces: string[] = data?.namespaces || []

    if (namespaces.some(n => n.includes('yoast'))) return 'yoast'
    if (namespaces.some(n => n.includes('rankmath'))) return 'rankmath'
    if (namespaces.some(n => n.includes('aioseo'))) return 'aioseo'
    if (namespaces.some(n => n.includes('schema-package'))) return 'schema-package'
    return null
  } catch {
    return null
  }
}

function mapPost(p: any, type: 'posts' | 'pages'): WPPost {
  return {
    id: p.id,
    title: p.title?.rendered ?? p.title?.raw ?? '',
    // context=edit gives .raw; never fall back to .rendered for content we
    // intend to write back.
    content: p.content?.raw ?? '',
    link: p.link,
    status: p.status,
    type
  }
}

export async function listPosts(conn: WPConnection, perPage = 20): Promise<WPPost[]> {
  const res = await fetch(
    `${conn.siteUrl}/wp-json/wp/v2/posts?per_page=${perPage}&context=edit&_fields=id,title,content,link,status`,
    { headers: { Authorization: authHeader(conn) }, signal: AbortSignal.timeout(20000) }
  )
  if (!res.ok) return []
  const data = await res.json()
  return Array.isArray(data) ? data.map((p: any) => mapPost(p, 'posts')) : []
}

/**
 * Resolve a live URL to its WordPress post or page.
 * Searches posts first, then pages; falls back to the configured front page
 * when the URL is the site root (site-level fixes target the homepage).
 */
export async function findPostByUrl(conn: WPConnection, url: string): Promise<WPPost | null> {
  const path = url.replace(/^https?:\/\/[^/]+/, '').replace(/\/+$/, '')

  // Site root → the front page
  if (!path) {
    for (const type of ['pages', 'posts'] as const) {
      const res = await fetch(
        `${conn.siteUrl}/wp-json/wp/v2/${type}?per_page=1&orderby=date&order=asc&context=edit&_fields=id,title,content,link,status`,
        { headers: { Authorization: authHeader(conn) }, signal: AbortSignal.timeout(15000) }
      )
      if (!res.ok) continue
      const data = await res.json()
      if (Array.isArray(data) && data.length) return mapPost(data[0], type)
    }
    return null
  }

  const slug = path.split('/').filter(Boolean).pop()
  if (!slug) return null

  for (const type of ['posts', 'pages'] as const) {
    const res = await fetch(
      `${conn.siteUrl}/wp-json/wp/v2/${type}?slug=${encodeURIComponent(slug)}&context=edit&_fields=id,title,content,link,status`,
      { headers: { Authorization: authHeader(conn) }, signal: AbortSignal.timeout(15000) }
    )
    if (!res.ok) continue
    const data = await res.json()
    if (Array.isArray(data) && data.length) return mapPost(data[0], type)
  }
  return null
}

async function updateContent(
  conn: WPConnection,
  post: WPPost,
  newContent: string,
  extraFields?: { title?: string }
): Promise<{ success: boolean; error?: string }> {
  const body: Record<string, unknown> = { content: newContent }
  if (extraFields?.title) body.title = extraFields.title

  const res = await fetch(`${conn.siteUrl}/wp-json/wp/v2/${post.type}/${post.id}`, {
    method: 'POST',  // WP REST API accepts POST for partial updates
    headers: {
      Authorization: authHeader(conn),
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000)
  })

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}))
    return { success: false, error: errData.message || `WordPress rejected the update (${res.status})` }
  }
  return { success: true }
}

/** Rewrite post content (and optionally title) — used by Fix Agent. */
export async function rewritePostContent(
  conn: WPConnection,
  post: WPPost,
  newContent: string,
  opts?: { title?: string }
): Promise<{ success: boolean; error?: string }> {
  return updateContent(conn, post, newContent, opts)
}

/**
 * Inject a JSON-LD block into a post's content.
 * Valid schema placement anywhere in the rendered body per schema.org, so this
 * works regardless of which SEO plugin is installed.
 */
export async function injectSchemaIntoPost(
  conn: WPConnection,
  post: WPPost,
  schemaJsonLd: Record<string, any>
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {

  if (!post.content && post.content !== '') {
    return { success: false, error: 'Could not read this post\'s source content — the account may lack edit permissions.' }
  }

  // Idempotent per @type: don't append a second Organization block on a second
  // click. (The spec only ever checked for Organization, so Article fixes
  // duplicated on every run.)
  const targetType = String(schemaJsonLd['@type'] || '')
  if (targetType) {
    const typePattern = new RegExp(`"@type"\\s*:\\s*"${targetType}"`, 'i')
    if (typePattern.test(post.content)) {
      return { success: true, skipped: true }
    }
  }

  const schemaScript = `\n<script type="application/ld+json">${JSON.stringify(schemaJsonLd)}</script>\n`
  return updateContent(conn, post, post.content + schemaScript)
}

/** Append/prepend plain HTML (e.g. a visible byline) into a post's content. */
export async function appendContentFix(
  conn: WPConnection,
  post: WPPost,
  htmlToAdd: string,
  position: 'start' | 'end' = 'start'
): Promise<{ success: boolean; error?: string; skipped?: boolean }> {

  // Idempotent — the marker class is what verification looks for.
  if (post.content.includes('seoranko-added-byline')) {
    return { success: true, skipped: true }
  }

  const newContent = position === 'start'
    ? htmlToAdd + post.content
    : post.content + htmlToAdd

  return updateContent(conn, post, newContent)
}
