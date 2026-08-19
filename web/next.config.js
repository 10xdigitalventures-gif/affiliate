/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,

  // Proxy /api/v1/* to backend
  async rewrites() {
    const target = (process.env.API_PROXY_URL || 'https://apiaffiliate.10xcollab.com').replace(/\/$/, '')
    return [{ source: '/api/v1/:path*', destination: `${target}/v1/:path*` }]
  },

  async headers() {
    return [
      {
        // Main app routes (excluding the embeddable signup widget and Shopify embedded app)
        source: '/((?!embed|embedded).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains; preload',
          },
          {
            key: 'Content-Security-Policy',
            value: [
              "default-src 'self'",
              // TODO: remove 'unsafe-inline' by migrating to nonce-based CSP.
              // 'unsafe-eval' has been removed. If a dependency reintroduces it,
              // audit and replace or sandbox that dependency.
              "script-src 'self' 'unsafe-inline'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https://apiaffiliate.10xcollab.com https:",
              "object-src 'none'",
              "base-uri 'self'",
              "frame-ancestors 'none'",
            ].join('; '),
          },
        ],
      },
      {
        // Embeddable affiliate signup widget — allow any host to frame it.
        source: '/embed/:path*',
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
      {
        // Shopify embedded app — only allow Shopify admin origins.
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
