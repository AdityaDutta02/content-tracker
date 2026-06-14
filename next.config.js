/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  experimental: { serverActions: { bodySizeLimit: '2mb' } },
  // Disable Next full-route data cache for HTML; we always want fresh client shell.
  // Build id forces unique bundle hash per deploy so CDN/edge cache cannot serve stale assets.
  generateBuildId: async () => `niche-wire-${Date.now()}`,
}
module.exports = nextConfig
