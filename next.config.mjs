import { withSentryConfig } from '@sentry/nextjs'

const PUBLISH_DOMAIN = process.env.NEXT_PUBLIC_PUBLISH_DOMAIN || 'blog.seoranko.com'

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ['sharp', '@sparticuz/chromium', 'puppeteer-core'],
  },
  // Hosted publish route (Step 2): serves under a SEORANKO subdomain via a
  // rewrite rather than a real subdirectory — the actual file-based route
  // stays app/(public)/blog/[brand]/[slug] (see publish-hosted.ts's
  // buildHostedPublicUrl comment), so adding a custom-domain tier later
  // only needs a new rewrite rule, not a change to the route itself.
  // Host-gated (has: [{ type: 'host', ... }]) so the primary app domain's
  // own root-level routing is completely unaffected.
  async rewrites() {
    return {
      beforeFiles: [
        { source: '/robots.txt', has: [{ type: 'host', value: PUBLISH_DOMAIN }], destination: '/robots.txt' },
        { source: '/:brand/sitemap.xml', has: [{ type: 'host', value: PUBLISH_DOMAIN }], destination: '/blog/:brand/sitemap.xml' },
        { source: '/:brand/llms.txt', has: [{ type: 'host', value: PUBLISH_DOMAIN }], destination: '/blog/:brand/llms.txt' },
        { source: '/:brand/:slug', has: [{ type: 'host', value: PUBLISH_DOMAIN }], destination: '/blog/:brand/:slug' },
      ],
    }
  },
  async redirects() {
    // Temporary (307 via permanent: false) — legacy content/keyword/ranking
    // surfaces → Overview. Mirrors LEGACY_DASHBOARD_ROUTES in
    // src/lib/legacy-dashboard-routes.ts; middleware also enforces these.
    // Do not delete the page files in this pass.
    const legacyToOverview = [
      '/dashboard/write',
      '/dashboard/keywords',
      '/dashboard/rankings',
      '/dashboard/briefs',
      '/dashboard/ai-visibility',
      '/dashboard/sitemap',
      '/dashboard/content',
      '/dashboard/content-roi',
      '/dashboard/images',
      '/dashboard/improve',
      '/dashboard/topical-map',
      '/dashboard/nlp',
      '/dashboard/optimise',
      '/dashboard/research',
      '/dashboard/discovery',
      '/dashboard/intelligence',
      '/dashboard/performance',
      '/dashboard/ranking-agent',
      '/dashboard/site-audit',
      '/dashboard/site-audit/repair-order',
      '/dashboard/extension',
      '/dashboard/articles',
      '/dashboard/humanize',
      '/dashboard/improve-article',
      '/dashboard/nlp-analyser',
      '/dashboard/roi',
    ]
    return legacyToOverview.map((source) => ({
      source,
      destination: '/dashboard',
      permanent: false,
    }))
  },
};

export default withSentryConfig(nextConfig, {
  // Upload source maps when SENTRY_AUTH_TOKEN is set (CI / Vercel).
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  silent: !process.env.SENTRY_AUTH_TOKEN,
  widenClientFileUpload: true,
  disableLogger: true,
  automaticVercelMonitors: true,
  sourcemaps: {
    disable: !process.env.SENTRY_AUTH_TOKEN,
  },
})
