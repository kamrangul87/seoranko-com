const PUBLISH_DOMAIN = process.env.NEXT_PUBLIC_PUBLISH_DOMAIN || 'blog.seoranko.com'

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['sharp'] },
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
    return [
      // Old hub URLs → new structure
      { source: '/dashboard/content',        destination: '/dashboard/write',        permanent: false },
      { source: '/dashboard/research',       destination: '/dashboard/keywords',     permanent: false },
      { source: '/dashboard/performance',    destination: '/dashboard/rankings',     permanent: false },
      { source: '/dashboard/ranking-agent',  destination: '/dashboard/rankings',     permanent: false },
      { source: '/dashboard/articles',       destination: '/dashboard/write',        permanent: false },
      { source: '/dashboard/humanize',       destination: '/dashboard/optimise',     permanent: false },
      { source: '/dashboard/improve',        destination: '/dashboard/optimise',     permanent: false },
      { source: '/dashboard/improve-article',destination: '/dashboard/optimise',     permanent: false },
      // §10 item 16: NLP is no longer embedded in Optimise. The old
      // '/dashboard/nlp -> optimise' redirect matched NLP's own real route,
      // which made the page unreachable outside the (now-removed) Optimise
      // tab. '/dashboard/nlp-analyser' is an alias, not a real route.
      { source: '/dashboard/nlp-analyser',   destination: '/dashboard/nlp',          permanent: false },
      { source: '/dashboard/images',         destination: '/dashboard/optimise',     permanent: false },
      { source: '/dashboard/site-audit',     destination: '/dashboard/intelligence', permanent: false },
      // §10 item 13: topical-map (Plan) and discovery (Discover) are now real
      // top-nav screens per §5 — no longer aliases into Keywords.
      { source: '/dashboard/content-roi',    destination: '/dashboard/rankings',     permanent: false },
      { source: '/dashboard/roi',            destination: '/dashboard/rankings',     permanent: false },
    ];
  },
};

export default nextConfig;
