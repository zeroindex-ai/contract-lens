import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DemoShell } from '@/ui/DemoShell';
import type { SampleManifestEntry } from '@/ui/SamplePicker';

/**
 * Server component. Reads the samples manifest at build time and passes it
 * to the client shell. All interactivity lives in DemoShell and below.
 */

export default function HomePage() {
  const manifestPath = join(process.cwd(), 'public', 'samples', 'manifest.json');
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8')) as { samples: SampleManifestEntry[] };
  return <DemoShell samples={manifest.samples} />;
}
