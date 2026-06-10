/** @type {import('next').NextConfig} */
const API_PROXY_TARGET = (
  process.env.API_PROXY_TARGET ||
  process.env.NEXT_PUBLIC_API_BASE_URL ||
  (process.env.NODE_ENV === 'development' ? 'http://localhost:5001' : 'https://172-182-227-84.nip.io')
).replace(/\/$/, '')

const nextConfig = {
  // Security: Hide technology information
  poweredByHeader: false,

  async rewrites() {
    return [
      {
        source: '/api/:path*',
        destination: `${API_PROXY_TARGET}/api/:path*`,
      },
    ]
  },
  
  // Security headers configuration
  async headers() {
    return [
      {
        // Apply these headers to all routes
        source: '/:path*',
        headers: [
          {
            key: 'Content-Security-Policy',
            value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdn.jsdelivr.net https://api.nylas.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data: https: http: blob:; connect-src 'self' https://api.nylas.com https://api.brevo.com https://172-182-227-84.nip.io https://172-182-227-84.nip.io https://auth.seemplifyai.com https://auth-dev.seemplifyai.com https://*.seemplifyai.com https://*.aiinnigeria.com wss: ws: http://localhost:* https://thesmarthr.netlify.app https://*.azurewebsites.net wss://*.azurewebsites.net; media-src 'self' blob:; object-src 'none'; frame-src 'self' blob: https://api.nylas.com; worker-src 'self' blob:; child-src 'self' blob:; form-action 'self'; upgrade-insecure-requests"
          },
          {
            key: 'X-Content-Type-Options',
            value: 'nosniff'
          },
          {
            key: 'X-Frame-Options',
            value: 'SAMEORIGIN'
          },
          {
            key: 'Referrer-Policy',
            value: 'strict-origin-when-cross-origin'
          },
          {
            key: 'Permissions-Policy',
            value: 'geolocation=(), microphone=(self), camera=()'
          },
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains'
          }
        ]
      }
    ]
  },
  
  images: {
    unoptimized: true,
  },
  typescript: {
    ignoreBuildErrors: true,
  },
  // Disable development features in production
  productionBrowserSourceMaps: false,
  
  // Turbopack configuration (Next.js 16+)
  turbopack: {
    root: process.cwd(),
  },
  
  // Disable webpack dev middleware
  webpack: (config, { dev, isServer }) => {
    if (!dev && !isServer) {
      // Disable any development-only features
      config.devtool = false;
    }
    return config;
  },
}

export default nextConfig
