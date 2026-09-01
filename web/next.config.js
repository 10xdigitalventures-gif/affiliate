/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Disable font optimization — it fetches Google Fonts at build time which
  // causes a silent hang on Windows / restricted networks.
  optimizeFonts: false,

  // Proxy /api/v1/* to backend
  async rewrites() {
    const target = (process.env.API_PROXY_URL || 'https://apiaffiliate.10xcollab.com').replace(/\/$/, '')
    return [{ source: '/api/v1/:path*', destination: `${target}/v1/:path*` }]
  },

  async headers() {
    return [
      {
        source: '/((?!embed|embedded).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data: https://fonts.gstatic.com",
              "connect-src 'self' http://localhost:4000 https://apiaffiliate.10xcollab.com https:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
      {
        source: '/embed/:path*',
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
      {
        source: '/embedded/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: 'frame-ancestors https://admin.shopify.com https://*.myshopify.com',
          },
        ],
      },
    ]
  },
}
module.exports = nextConfig
