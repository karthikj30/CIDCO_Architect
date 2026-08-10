/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: {
    serverActions: {
      // AQI report bundles include board photographs, so allow large payloads.
      bodySizeLimit: '25mb',
    },
  },
};

export default nextConfig;
