/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: 'standalone',
  // Proxy /api/v1/* to the backend so public pages (apply, embed) can use
  // same-origin relative fetches. Override the target with API_PROXY_URL.
  async rewrites() {
    const target = (process.env.API_PROXY_URL || 'http://localhost:4000').replace(/\/$/, '')
    return [{ source: '/api/v1/:path*', destination: `${target}/v1/:path*` }]
  },
  // Allow the embeddable sign-up form to be framed on any tenant site
  // (WordPress, Shopify, custom sites). Everything else keeps browser defaults.
  async headers() {
    return [
      {
        // Security hardening for all dashboard and portal routes.
        // These headers add clickjack protection, MIME-sniff prevention,
        // referrer control and browser-feature lockdown with zero breakage.
        source: '/((?!embed|embedded).*)',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
          {
            key: 'Content-Security-Policy',
            // frame-ancestors none prevents the dashboard from being embedded
            // in an attacker-controlled page (clickjacking).
            // upgrade-insecure-requests forces HTTPS in production.
            // script-src and object-src restrict execution surface.
            value: [
              "default-src 'self'",
              "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob: https:",
              "font-src 'self' data:",
              "connect-src 'self' https: http://localhost:4000",
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
        // Allow the embedded app to be framed only inside the Shopify admin.
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
