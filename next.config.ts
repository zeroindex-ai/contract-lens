import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  // Don't bundle pdfjs-dist into the server build — it dynamically imports its
  // worker module relative to its own package location, which breaks when Next
  // rewrites it into a .next chunk path. Loading it from node_modules at
  // runtime lets pdfjs resolve its worker correctly (server-side text extraction).
  serverExternalPackages: ['pdfjs-dist'],
};

export default nextConfig;
