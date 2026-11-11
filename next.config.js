/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ['lucide-react'],
  images: {
    domains: ['assets.tigerex.com', 'static.tigerex.io'],
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '*.tigerex.com',
      },
    ],
  },

  /**
   * Canonical-route redirects.
   *
   * Several navigation entries and marketing links point at older path names.
   * Rather than leave them 404ing, each is mapped onto the route that actually
   * serves it. These are permanent so clients and search engines converge on the
   * canonical path.
   */
  async redirects() {
    return [
      { source: '/exchange', destination: '/spot', permanent: true },
      { source: '/buy', destination: '/fiat', permanent: true },
      { source: '/api', destination: '/api-docs', permanent: true },
      { source: '/verification', destination: '/kyc', permanent: true },
      { source: '/support', destination: '/help', permanent: true },
      { source: '/grid-trading', destination: '/bots', permanent: true },
      { source: '/trade', destination: '/spot', permanent: true },
    ];
  },

  async headers() {
    // The Content-Security-Policy and the other security headers are set in
    // `src/middleware.ts`, because the CSP needs a per-request nonce and this
    // file cannot mint one. Declaring a CSP here as well would emit a second
    // header, and two CSPs intersect — the weaker one would win, which is how
    // the old `script-src 'unsafe-inline'` policy would survive.
    return [
      // Every API response is per-request and must never be stored by a browser,
      // proxy or CDN: balances, order books and account state are all sensitive
      // and time-critical. This is a belt-and-braces guarantee on top of each
      // handler's own NO_STORE header.
      {
        source: '/api/:path*',
        headers: [{ key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate' }],
      },
    ];
  },
};

module.exports = nextConfig;