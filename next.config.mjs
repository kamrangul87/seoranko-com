/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: { serverComponentsExternalPackages: ['sharp'] },
  async redirects() {
    return [
      { source: '/dashboard/keywords', destination: '/dashboard/research', permanent: false },
      { source: '/dashboard/topical-map', destination: '/dashboard/research', permanent: false },
      { source: '/dashboard/discovery', destination: '/dashboard/research', permanent: false },
      { source: '/dashboard/rankings', destination: '/dashboard/performance', permanent: false },
      { source: '/dashboard/roi', destination: '/dashboard/performance', permanent: false },
      { source: '/dashboard/site-audit', destination: '/dashboard/intelligence', permanent: false },
      { source: '/dashboard/improve', destination: '/dashboard', permanent: false },
      { source: '/dashboard/nlp', destination: '/dashboard', permanent: false },
    ];
  },
};

export default nextConfig;
