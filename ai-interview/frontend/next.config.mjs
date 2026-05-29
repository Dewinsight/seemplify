/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = (
  process.env.API_PROXY_TARGET ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  'http://localhost:5101'
).replace(/\/$/, '')

const nextConfig = {
  poweredByHeader: false,
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/api/:path*`
      }
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https: http:; connect-src 'self' http://localhost:* ws://localhost:* https://*.microsoft.com https://*.azure.com https://*.azurewebsites.net; media-src 'self' blob:; object-src 'none'; frame-src 'self'; worker-src 'self' blob:;"
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'geolocation=(), microphone=(self), camera=()' }
        ]
      }
    ]
  },
  images: {
    unoptimized: true
  },
  productionBrowserSourceMaps: false
}

export default nextConfig
