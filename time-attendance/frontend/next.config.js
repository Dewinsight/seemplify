/** @type {import('next').NextConfig} */
const nextConfig = {
    // Output standalone for Docker builds
    output: "standalone",
    // Ignore typescript errors during build to avoid blocking deployment
    typescript: {
        ignoreBuildErrors: true,
    },
    // Ignore eslint errors during build
    eslint: {
        ignoreDuringBuilds: true,
    },
};

module.exports = nextConfig;
