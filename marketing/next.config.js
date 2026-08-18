/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Required for Cloudflare Pages (next-on-pages)
  experimental: {
    runtime: 'edge',
  },
}
module.exports = nextConfig
