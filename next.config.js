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
};

module.exports = nextConfig;