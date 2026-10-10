/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  // The end-to-end tests build into their own folder, so they never disturb a running `npm run dev`.
  distDir: process.env.NEXT_DIST_DIR || '.next',
};

export default nextConfig;
