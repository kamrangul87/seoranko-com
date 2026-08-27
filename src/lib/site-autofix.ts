/* eslint-disable @typescript-eslint/no-explicit-any */
// src/lib/site-autofix.ts
// Applies a RANKO issue fix to a connected site via its platform adapter
// (WordPress / Shopify / Webflow / Universal Tag), then re-fetches the live
// page to confirm the fix took effect rather than trusting the write.

import { normaliseSiteUrl } from './wordpress-connector'
import { getAdapter } from './site-adapters'
import type { FixApplyResult } from './site-adapters/types'
import { validateSchema } from './schema-validator'
import { checkSiteWashout } from './treatment-log'
import { loadConnectionCredentials } from './site-connection-crypto'

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
      message: 'No CMS connection found for this site. Connect it in Settings → Your Sites first.'
    }
  }

  const siteUrl = normaliseSiteUrl(targetUrl)
  if (!siteUrl) {
    return { success: false, applied: false, verified: false, message: 'That site URL cannot be reached.' }
  }

  // §10 item 9 / §7.3 / §7.8: "one live treatment per unit, no exceptions."
  // Checked before touching the adapter so a blocked request costs nothing.
  const washout = await checkSiteWashout(supabase, siteId, targetUrl)
  if (!washout.allowed) {
    return { success: false, applied: false, verified: false, message: washout.reason }
  }

  const platform = connRow.cms_type || 'wordpress'
  const adapter = getAdapter(platform, supabase)

  const loaded = loadConnectionCredentials(connRow)
  const creds = {
    siteUrl,
    siteId,
    ...loaded,
  }

  const check = await adapter.verifyConnection(creds)
  if (!check.success) {
    return { success: false, applied: false, verified: false, message: check.error || 'Connection failed' }
  }

  const page = await adapter.findPageContent(creds, targetUrl)
  if (!page) {
    return {
      success: false,
      applied: false,
      verified: false,
      message: `Could not find this page on the connected ${platform} site. The URL may not map to an editable page, or the slug format differs.`
    }
  }

  let applyResult: FixApplyResult

  if (fixType === 'schema-org-inject') {
    applyResult = await adapter.injectSchema(creds, page, {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      name: brandName,
      url: siteUrl,
      ...(brandDescription ? { description: brandDescription } : {})
    })
  } else if (fixType === 'schema-article-inject') {
    applyResult = await adapter.injectSchema(creds, page, {
      '@context': 'https://schema.org',
      '@type': 'Article',
      headline: page.title || brandName,
      datePublished: new Date().toISOString().split('T')[0],
      author: { '@type': 'Organization', name: brandName }
    })
  } else if (fixType === 'author-bio-visible') {
    applyResult = await adapter.appendContent(
      creds, page,
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
      liveUrl: page.url
    }
  }

  // Some fixes are written but not live yet — a static-site rebuild after a
  // commit, or a Pull Request awaiting a human merge. Blocking the request
  // long enough for a rebuild would exceed maxDuration and surface as an error
  // even though the fix landed, so report the real state and let the user
  // re-run the diagnosis once it's live.
  if (applyResult.pending || adapter.deferredVerification) {
    const detail = applyResult.detail
      || 'Change written, but not live yet — re-run the diagnosis once your site has rebuilt.'
    await supabase.from('site_autofix_log').insert({
      user_id: userId,
      site_id: siteId,
      issue_id: issueId,
      fix_type: fixType,
      target_url: targetUrl,
      verified: false,
      legacy_target: fixType,
      verification_result: { detail, platform, pending: true, url: applyResult.url ?? null }
    })
    return {
      success: true,
      applied: true,
      verified: false,
      message: detail,
      liveUrl: applyResult.url || page.url
    }
  }

  // The Universal Tag injects via JavaScript, so a server-side fetch will never
  // see it. Reporting "not verified" would imply something went wrong; say what
  // is actually true instead.
  if (!adapter.serverVerifiable) {
    const detail = 'Fix queued on the Universal Tag. It applies in the browser when the page loads, so it cannot be confirmed by a server-side fetch — check with Google Rich Results Test, which renders JavaScript.'
    await supabase.from('site_autofix_log').insert({
      user_id: userId,
      site_id: siteId,
      issue_id: issueId,
      fix_type: fixType,
      target_url: targetUrl,
      verified: false,
      legacy_target: fixType,
      verification_result: { detail, platform, jsInjected: true }
    })
    return { success: true, applied: true, verified: false, message: detail, liveUrl: page.url }
  }

  // VERIFICATION LOOP — re-fetch the LIVE public page (not the API response)
  // and confirm the fix genuinely reached the public-facing site.
  let verified = false
  let verificationDetail = ''

  try {
    await new Promise(r => setTimeout(r, 1500))  // brief pause for cache/CDN
    const liveRes = await fetch(page.url, {
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
        : `Fix was written, but ${wanted} schema was not detected on re-fetch — the page may be cached. Check again in a few minutes.`
    } else {
      verified = liveHtml.includes('seoranko-added-byline')
      verificationDetail = verified
        ? 'Confirmed: the byline is now visible on the live page.'
        : 'Fix was written, but is not yet visible — likely a cache delay.'
    }
  } catch {
    verificationDetail = 'Fix was written, but the live page could not be re-fetched to verify it.'
  }

  await supabase.from('site_autofix_log').insert({
    user_id: userId,
    site_id: siteId,
    issue_id: issueId,
    fix_type: fixType,
    target_url: targetUrl,
    verified,
    legacy_target: fixType,
    verification_result: { detail: verificationDetail, pageId: page.id, platform }
  })

  return {
    success: true,
    applied: true,
    verified,
    message: verificationDetail,
    liveUrl: page.url
  }
}
