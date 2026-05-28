/** @type {import('next').NextConfig} */
const nextConfig = {
  allowedDevOrigins: [
    'conviction-hydrocodone-professionals-demonstration.trycloudflare.com',
  ],
  webpack: (config) => {
    config.resolve.alias.canvas = false;
    return config;
  },
};

export default nextConfig;
