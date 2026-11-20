import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.NEXT_DIST_DIR || ".next",
  /* config options here */
  allowedDevOrigins: ["127.0.0.1"],
  cacheComponents: true,
  partialPrefetching: true,
  experimental: {
    // A 10 MiB source file also needs room for its multipart envelope.
    proxyClientMaxBodySize: 11 * 1024 * 1024,
    // Keep builds within available RAM while the speaking model is running.
    cpus: 2,
  },
  turbopack: {
    root: __dirname,
    rules: {
      "*.css": {
        condition: { not: { path: /\.module\.css$/ } },
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
