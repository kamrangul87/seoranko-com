/**
 * Developer-path Manual Fix snippets with explicit file placement instructions.
 * Written for site owners who may need to hand this to a developer — not blind paste.
 */

import type { ManualFixSnippet } from '@/lib/index-diagnosis/types'

export const FIX_AGENT_DEVELOPER_FALLBACK =
  "If you don't have a developer or file access, use the Run Fix Agent button on the Site Audit page instead — when your site is connected via GitHub, Fix Agent can commit and deploy this change for you."

export const DEPLOY_AFTER_SAVE_NOTE =
  'After saving, this file must be committed to your repo and deployed before the redirect works on your live site. If SEORANKO is connected via GitHub, Run Fix Agent on the audit page can attempt this automatically instead of editing files by hand.'

function pathFromUrl(url: string): string {
  try {
    return new URL(url).pathname || '/'
  } catch {
    return url
  }
}

function regexEscapePath(path: string): string {
  return path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\//g, '\\/')
}

export function buildNextJsRedirectSnippet(fromUrl: string, toUrl: string, evidence: string): ManualFixSnippet {
  const fromPath = pathFromUrl(fromUrl)
  const toPath = pathFromUrl(toUrl)

  const fullConfig = `/** @type {import('next').NextConfig} */
const nextConfig = {
  async redirects() {
    return [
      {
        source: '${fromPath}',
        destination: '${toPath}',
        permanent: true,
      },
    ]
  },
}

module.exports = nextConfig`

  const mergeOnly = `      {
        source: '${fromPath}',
        destination: '${toPath}',
        permanent: true,
      },`

  return {
    id: 'redirect-nextjs',
    label: 'Next.js (next.config.js)',
    kind: 'redirect-nextjs',
    placementBefore: `WHICH FILE: next.config.js (or next.config.mjs) in your project root — the same folder as package.json.

WHERE IN THE FILE: Inside the async redirects() function, in the array it returns. The snippet below is a complete, valid file if you do not have next.config.js yet.

If you already have redirects(), copy only the { source, destination, permanent } object into the existing return [ ... ] array — do not paste the whole file on top of your config.

Evidence from this crawl: ${evidence}`,
    content: fullConfig,
    placementAfter: `Already have redirects()? Add this object inside the return array instead of replacing the whole file:

${mergeOnly}

${DEPLOY_AFTER_SAVE_NOTE}

${FIX_AGENT_DEVELOPER_FALLBACK}`,
  }
}

export function buildHtaccessRedirectSnippet(fromUrl: string, toUrl: string, evidence: string): ManualFixSnippet {
  const fromPath = pathFromUrl(fromUrl)
  const toPath = pathFromUrl(toUrl)
  const fromRegex = regexEscapePath(fromPath)

  return {
    id: 'redirect-htaccess',
    label: 'Apache (.htaccess)',
    kind: 'redirect-htaccess',
    placementBefore: `WHICH FILE: .htaccess in your website's root directory (often public_html, www, or htdocs via FTP/cPanel).

WHEN THIS APPLIES: Only if your host runs Apache and allows .htaccess overrides. Many WordPress hosts use Apache; Node/Next.js hosts (Vercel, Netlify) usually do NOT use .htaccess — use the Next.js tab instead.

If you are on shared hosting without FTP or file manager access, you likely cannot edit this file yourself. Use the WordPress tab above, or Run Fix Agent if GitHub is connected.

Evidence from this crawl: ${evidence}`,
    content: `# Enable rewrite engine once at the top of .htaccess if not already present:
RewriteEngine On

# 301 redirect — ${evidence}
RewriteRule ^${fromRegex.slice(1)}$ ${toPath} [R=301,L]`,
    placementAfter: DEPLOY_AFTER_SAVE_NOTE,
  }
}

export function buildNginxRedirectSnippet(fromUrl: string, toUrl: string, evidence: string): ManualFixSnippet {
  const fromPath = pathFromUrl(fromUrl)
  const toPath = pathFromUrl(toUrl)

  return {
    id: 'redirect-nginx',
    label: 'nginx (server config)',
    kind: 'redirect-nginx',
    placementBefore: `WHICH FILE: Your site's nginx configuration — usually inside /etc/nginx/sites-available/ or a block managed by your hosting provider. This is not a file in your GitHub repo unless you self-host.

WHO CAN EDIT THIS: Typically a developer, DevOps engineer, or hosting support. Most beginner users on shared hosting or managed platforms (Vercel, Netlify, Shopify) cannot edit nginx directly — use the platform-specific tabs above instead of this snippet.

Evidence from this crawl: ${evidence}`,
    content: `# Inside the server { ... } block for your domain:
# 301 redirect — ${evidence}
rewrite ^${fromPath}$ ${toPath} permanent;`,
    placementAfter: `After editing nginx config, run: sudo nginx -t && sudo systemctl reload nginx (or ask your host to reload). ${DEPLOY_AFTER_SAVE_NOTE}`,
  }
}

export function buildCanonicalTagSnippetWithPlacement(pageUrl: string, evidence: string): ManualFixSnippet {
  return {
    id: 'canonical-self',
    label: 'Self-referencing canonical tag',
    kind: 'html',
    placementBefore: `WHICH FILE: The HTML <head> of ${pageUrl} — in your theme template, page builder, or static HTML file depending on how the page is built.

WHERE IN THE FILE: Inside <head>, typically near other <link> and <meta> tags. Replace any existing <link rel="canonical"> that points elsewhere, or add this if none exists.

Evidence from this crawl: ${evidence}`,
    content: `<link rel="canonical" href="${pageUrl}" />`,
    placementAfter: `Save and publish the page (or deploy your theme) for the change to appear on the live site. ${FIX_AGENT_DEVELOPER_FALLBACK}`,
  }
}

export function buildVercelJsonRedirectSnippet(fromUrl: string, toUrl: string, evidence: string): ManualFixSnippet {
  const fromPath = pathFromUrl(fromUrl)
  const toPath = pathFromUrl(toUrl)

  const fullFile = `{
  "redirects": [
    {
      "source": "${fromPath}",
      "destination": "${toPath}",
      "permanent": true
    }
  ]
}`

  const mergeEntry = `    {
      "source": "${fromPath}",
      "destination": "${toPath}",
      "permanent": true
    }`

  return {
    id: 'redirect-vercel',
    label: 'Vercel (vercel.json)',
    kind: 'redirect-vercel',
    placementBefore: `WHICH FILE: vercel.json in your project root — the same folder as package.json.

WHERE IN THE FILE: Inside the top-level "redirects" array. If you already have redirects (www → apex, legacy paths, etc.), add the object below to that array — do not replace the whole file.

WHEN THIS APPLIES: Vite, React, and static sites deployed on Vercel use vercel.json for redirects. Next.js App Router projects may use next.config.js instead — use the Next.js tab if that matches your stack.

Evidence from this crawl: ${evidence}`,
    content: fullFile,
    placementAfter: `Already have a redirects array? Add only this object inside it:

${mergeEntry}

${DEPLOY_AFTER_SAVE_NOTE}

${FIX_AGENT_DEVELOPER_FALLBACK}`,
  }
}

export function developerRedirectSnippets(fromUrl: string, toUrl: string, evidence: string): ManualFixSnippet[] {
  return [
    buildVercelJsonRedirectSnippet(fromUrl, toUrl, evidence),
    buildNextJsRedirectSnippet(fromUrl, toUrl, evidence),
    buildHtaccessRedirectSnippet(fromUrl, toUrl, evidence),
    buildNginxRedirectSnippet(fromUrl, toUrl, evidence),
  ]
}
