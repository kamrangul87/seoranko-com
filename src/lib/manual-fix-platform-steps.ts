/**
 * Click-by-click platform instructions for infrastructure fixes (redirects).
 * Real URLs filled in from crawl evidence — no invented paths.
 */

export type ManualFixPlatform = 'wordpress' | 'shopify' | 'squarespace' | 'wix' | 'developer'

export interface RedirectTarget {
  fromUrl: string
  toUrl: string
  evidence: string
  httpStatus?: number
}

function pathFromUrl(url: string): string {
  try {
    const p = new URL(url).pathname
    return p || '/'
  } catch {
    return url
  }
}

export function platformRedirectSteps(
  platform: ManualFixPlatform,
  target: RedirectTarget,
): string {
  const fromPath = pathFromUrl(target.fromUrl)
  const toPath = pathFromUrl(target.toUrl)
  const statusNote = target.httpStatus ? ` (currently HTTP ${target.httpStatus})` : ''

  switch (platform) {
    case 'wordpress':
      return `WordPress — Redirection plugin (free)
Evidence: ${target.evidence}${statusNote}

1. Log in to WordPress admin
2. Go to Tools → Redirection (install "Redirection" from Plugins if needed)
3. Click "Add new redirect"
4. Source URL: ${fromPath}
5. Target URL: ${toPath}
6. HTTP code: 301 — Moved Permanently
7. Click "Add Redirect"

Alternative without a plugin: ask your host to add a redirect rule, or use "I have file access" below.`

    case 'shopify':
      return `Shopify — URL Redirect
Evidence: ${target.evidence}${statusNote}

1. Log in to Shopify admin
2. Go to Online Store → Navigation
3. Open the "URL Redirects" tab (or Settings → Apps and sales channels → URL redirects)
4. Click "Create URL redirect"
5. Redirect from: ${fromPath}
6. Redirect to: ${toPath}
7. Save

If the page should exist instead, create the page at ${fromPath} rather than redirecting.`

    case 'squarespace':
      return `Squarespace — URL mapping
Evidence: ${target.evidence}${statusNote}

1. Log in to Squarespace
2. Go to Settings → Advanced → URL Mappings
3. Click "Add"
4. Enter: ${fromPath} → ${toPath} 301
5. Save

Format is exactly: old-path → /new-path 301 (one mapping per line in bulk import).`

    case 'wix':
      return `Wix — URL redirect
Evidence: ${target.evidence}${statusNote}

1. Open your Wix dashboard
2. Go to Settings → SEO Tools → URL Redirect Manager
3. Click "New Redirect"
4. Old URL: ${fromPath}
5. New URL: ${toPath}
6. Redirect type: 301 (Permanent)
7. Save`

    case 'developer':
      return ''
  }
}

export function removeDeadLinkGuidance(
  platform: ManualFixPlatform,
  deadUrl: string,
  sourcePages: string[],
): string {
  const deadPath = pathFromUrl(deadUrl)
  const sources = sourcePages.length > 0 ? sourcePages.join('\n   • ') : '(source page not captured in crawl)'

  if (platform === 'developer') {
    return `Remove or update links pointing to ${deadUrl} on:
   • ${sources}

Edit each page's HTML/theme and delete the <a href="${deadPath}"> link, or point it to the correct live URL.`
  }

  const platformEdit =
    platform === 'wordpress'
      ? 'Pages → edit each source page in the block editor'
      : platform === 'shopify'
        ? 'Online Store → Pages → edit each source page'
        : platform === 'squarespace'
          ? 'Pages → edit each source page'
          : 'Editor → open each page listed below'

  return `Option A — Remove the dead link (recommended if ${deadPath} should not exist)
Evidence: ${deadUrl} returned an error during this crawl.

Pages that link to it:
   • ${sources}

Steps:
1. ${platformEdit}
2. Find the link to "${deadPath}" (use Find on page if needed)
3. Delete the link or replace it with a working page URL
4. Save / publish each page`
}

export const PLATFORM_LABELS: Record<ManualFixPlatform, string> = {
  wordpress: 'WordPress',
  shopify: 'Shopify',
  squarespace: 'Squarespace',
  wix: 'Wix',
  developer: 'My developer / I have file access',
}
