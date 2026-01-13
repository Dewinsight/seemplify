import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Optimize for production builds
  swcMinify: true,

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

  // Disable ESLint warnings for production build
  eslint: {
    ignoreDuringBuilds: false,
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

  // Webpack configuration for better build performance
  webpack: (config, { isServer }) => {
    // Handle node modules correctly
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        fs: false,
        net: false,
        tls: false,
      };
    }
    return config;
  },
};

export default nextConfig;
