import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  images: {
    unoptimized: true,
  },
  // Reduce CPU usage in dev mode
  experimental: {
    cpus: 1, // Limit CPU cores used by Turbopack
  },
  turbopack: {
    root: __dirname,
  },
  async rewrites() {
    // Rewrites proxy to localhost since API runs on the same machine
    // This works even when accessed from LAN - Next.js server handles the proxy
    return [
      {
        source: '/api/:path*',
        destination: 'http://localhost:6969/api/:path*',
      },
      {
        source: '/static/:path*',
        destination: 'http://localhost:6969/static/:path*',
      },
    ];
  },
};

export default nextConfig;
