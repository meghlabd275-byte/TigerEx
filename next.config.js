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
  experimental: {
    typedRoutes: true,
  },
  eslint: {
    ignoreDuringBuilds: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
};

module.exports = nextConfig;