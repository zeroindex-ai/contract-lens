import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  devIndicators: false,
  // Don't bundle pdfjs-dist into the server build — it dynamically imports its
  // worker module relative to its own package location, which breaks when Next
  // rewrites it into a .next chunk path. Loading it from node_modules at
  // runtime lets pdfjs resolve its worker correctly (server-side text extraction).
  serverExternalPackages: ['pdfjs-dist'],
  // Vercel's file tracer follows static imports only; pdfjs loads its worker
  // via a DYNAMIC import, so pdf.worker.mjs isn't traced into the /api/extract
  // function bundle and 500s at runtime ("Cannot find module pdf.worker.mjs").
  // Force-include the legacy build's .mjs files (glob covers the pnpm layout).
  outputFileTracingIncludes: {
    '/api/extract': ['./node_modules/**/pdfjs-dist/legacy/build/*.mjs'],
  },
};

export default nextConfig;
