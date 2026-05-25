import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  serverExternalPackages: ['@libsql/client', 'undici'],
};

export default nextConfig;
