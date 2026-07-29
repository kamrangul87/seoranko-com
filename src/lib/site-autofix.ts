/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/site-autofix.ts
// Applies a RANKO issue's fix to a connected WordPress site via the real REST
// API, then RE-FETCHES the live public page to confirm the fix actually took
// effect — rather than trusting that the write succeeded.

import {
  WPConnection,
  verifyConnection,
  findPostByUrl,
  injectSchemaIntoPost,
  appendContentFix,
  normaliseSiteUrl
} from './wordpress-connector'
import { validateSchema } from './schema-validator'

export type SiteFixType = 'schema-org-inject' | 'schema-article-inject' | 'author-bio-visible'

export interface AutoFixResult {
  success: boolean
  applied: boolean
  verified: boolean
  message: string
  liveUrl?: string
  /** True when the fix was already present — nothing was written. */
  alreadyPresent?: boolean
}

export async function applySiteAutoFix(
  supabase: any,
  userId: string,
  siteId: string,
  issueId: string,
  fixType: SiteFixType,
  targetUrl: string,
  brandName: string,
  brandDescription: string
): Promise<AutoFixResult> {

  const { data: connRow } = await supabase
    .from('site_connections')
    .select('*')
    .eq('site_id', siteId)
    .eq('user_id', userId)          // never trust siteId alone
    .eq('is_active', true)
    .maybeSingle()

  if (!connRow) {
    return {
      success: false,
      applied: false,
      verified: false,
      message: 'No WordPress connection found for this site. Connect it in Settings → Your Sites first.'
    }
  }

  const siteUrl = normaliseSiteUrl(targetUrl)
  if (!siteUrl) {
    return { success: false, applied: false, verified: false, message: 'That site URL cannot be reached.' }
  }

  const conn: WPConnection = {
    siteUrl,
    username: connRow.wp_username,
    appPassword: connRow.wp_app_password
  }

  const check = await verifyConnection(conn)
  if (!check.success) {
    return { success: false, applied: false, verified: false, message: check.error || 'Connection failed' }
  }

  const post = await findPostByUrl(conn, targetUrl)
  if (!post) {
    return {
      success: false,
      applied: false,
      verified: false,
      message: 'Could not find a matching WordPress post or page for this URL. It may not be a standard post, or the slug format differs.'
    }
  }

  let applyResult: { success: boolean; error?: string; skipped?: boolean }

  if (fixType === 'schema-org-inject') {
    applyResult = await injectSchemaIntoPost(conn, post, {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: brandName,
      url: conn.siteUrl,
      ...(brandDescription ? { description: brandDescription } : {})
    })
  } else if (fixType === 'schema-article-inject') {
    applyResult = await injectSchemaIntoPost(conn, post, {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: post.title,
      // Today's date is the publish date only if we genuinely don't know it;
      // WordPress owns the real value, so prefer nothing over a wrong claim.
      datePublished: new Date().toISOString().split('T')[0],
      author: { '@type': 'Organization', name: brandName }
    })
  } else if (fixType === 'author-bio-visible') {
    applyResult = await appendContentFix(
      conn, post,
      `<p class="seoranko-added-byline"><em>Published by ${brandName}</em></p>\n`,
      'start'
    )
  } else {
    return { success: false, applied: false, verified: false, message: 'Unknown fix type' }
  }

  if (!applyResult.success) {
    return { success: false, applied: false, verified: false, message: applyResult.error || 'Failed to write the fix' }
  }

  if (applyResult.skipped) {
    return {
      success: true,
      applied: false,
      verified: true,
      alreadyPresent: true,
      message: 'This fix is already present on the page — nothing needed changing.',
      liveUrl: post.link
    }
  }

  // VERIFICATION LOOP — re-fetch the LIVE public page (not the API response)
  // and confirm the fix genuinely reached the public-facing site.
  let verified = false
  let verificationDetail = ''

  try {
    await new Promise(r => setTimeout(r, 1500))  // brief pause for cache/CDN
    const liveRes = await fetch(post.link, {
      headers: { 'User-Agent': 'SEORANKO-Verifier/1.0', 'Cache-Control': 'no-cache' },
      signal: AbortSignal.timeout(20000)
    })
    const liveHtml = await liveRes.text()

    if (fixType.startsWith('schema-')) {
      const wanted = fixType === 'schema-org-inject' ? 'Organization' : 'Article'
      const schemaCheck = validateSchema(liveHtml)
      // Check for the type we just wrote, not merely "any schema exists" —
      // a page with unrelated pre-existing schema would otherwise self-verify.
      verified = schemaCheck.schemasFound.includes(wanted)
      verificationDetail = verified
        ? `Confirmed: ${wanted} schema is now live on the page (found: ${schemaCheck.schemasFound.join(', ')}).`
        : `Fix was written to WordPress, but ${wanted} schema was not detected on re-fetch — the page may be cached. Check again in a few minutes.`
    } else {
      verified = liveHtml.includes('seoranko-added-byline')
      verificationDetail = verified
        ? 'Confirmed: the byline is now visible on the live page.'
        : 'Fix was written, but is not yet visible — likely a cache delay.'
    }
  } catch {
    verificationDetail = 'Fix was written to WordPress, but the live page could not be re-fetched to verify it.'
  }

  await supabase.from('site_autofix_log').insert({
    user_id: userId,
    site_id: siteId,
    issue_id: issueId,
    fix_type: fixType,
    target_url: targetUrl,
    verified,
    verification_result: { detail: verificationDetail, postId: post.id, postType: post.type }
  })

  return {
    success: true,
    applied: true,
    verified,
    message: verificationDetail,
    liveUrl: post.link
  }
}
