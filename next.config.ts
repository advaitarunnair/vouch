import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Lets a production build be tested locally next to the dev server (NEXT_DIST_DIR=.next-prod).
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["better-sqlite3"],
  poweredByHeader: false,
};

export default nextConfig;
