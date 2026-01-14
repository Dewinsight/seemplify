import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Ensure environment variables are available
  env: {
    NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
    NEXT_PUBLIC_WS_URL: process.env.NEXT_PUBLIC_WS_URL,
    NEXT_PUBLIC_IDP_URL: process.env.NEXT_PUBLIC_IDP_URL,
    NEXTAUTH_URL: process.env.NEXTAUTH_URL,
    OIDC_ISSUER: process.env.OIDC_ISSUER,
    OIDC_CLIENT_ID: process.env.OIDC_CLIENT_ID,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET,
  },

  // Disable TypeScript strict checks for production build
  typescript: {
    ignoreBuildErrors: false,
  },

  // Handle image optimization
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: '**',
      },
    ],
    unoptimized: false,
  },

  // Experimental features
  experimental: {
    // Optimize package imports
    optimizePackageImports: ['lucide-react', '@mui/material'],
  },

  // Output configuration
  output: 'standalone',

  // Turbopack configuration (Next.js 16 default)
  turbopack: {
    // Resolve fallbacks for browser builds
    resolveAlias: {
      fs: { browser: './empty-module.js' },
      net: { browser: './empty-module.js' },
      tls: { browser: './empty-module.js' },
    },
  },
};

export default nextConfig;
