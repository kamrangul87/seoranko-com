/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['sharp'] },
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
      { source: '/dashboard/nlp',            destination: '/dashboard/optimise',     permanent: false },
      { source: '/dashboard/nlp-analyser',   destination: '/dashboard/optimise',     permanent: false },
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
