/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = (
  process.env.API_PROXY_TARGET ||
  process.env.NEXT_PUBLIC_RECRUITER_API_BASE_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : 'https://api.seemplifyai.com')
).replace(/\/$/, '')

const nextConfig = {
  poweredByHeader: false,
  turbopack: {
    root: process.cwd(),
  },
  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ]
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https: blob:; connect-src 'self' https://api.seemplifyai.com https://api-dev.seemplifyai.com https://*.seemplifyai.com https://*.aiinnigeria.com http://localhost:*; frame-src 'self' https: blob:; object-src 'none'; form-action 'self'; base-uri 'self'"
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' }
        ]
      }
    ]
  },
  images: {
    unoptimized: true,
  },
}

export default nextConfig
