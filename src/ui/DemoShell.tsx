'use client';

import { useState } from 'react';
import type { VerifiedContractExtraction } from '@/lib/verify';
import { SamplePicker, type SampleManifestEntry } from './SamplePicker';
import { UploadZone } from './UploadZone';
import { ExtractionViewer, type ExtractionMetadataShape } from './ExtractionViewer';

export interface DemoShellProps {
  samples: SampleManifestEntry[];
}

type ViewState =
  | { kind: 'initial' }
  | { kind: 'loading'; label: string }
  | { kind: 'error'; message: string }
  | {
      kind: 'extracted';
      sourceLabel: string;
      pdfUrl: string;
      extraction: VerifiedContractExtraction;
      metadata?: ExtractionMetadataShape;
    };

export function DemoShell({ samples }: DemoShellProps) {
  const [view, setView] = useState<ViewState>({ kind: 'initial' });

  async function pickSample(sample: SampleManifestEntry) {
    setView({ kind: 'loading', label: `Loading ${sample.title}…` });
    try {
      const res = await fetch(sample.json_path);
      if (!res.ok) throw new Error(`Failed to load sample (${res.status})`);
      const extraction = (await res.json()) as VerifiedContractExtraction;
      setView({
        kind: 'extracted',
        sourceLabel: `${sample.title} · sample`,
        pdfUrl: sample.pdf_path,
        extraction,
        metadata: { page_count: sample.page_count },
      });
    } catch (err) {
      setView({ kind: 'error', message: err instanceof Error ? err.message : 'Failed to load sample' });
    }
  }

  async function uploadFile(file: File) {
    // Object URL so the PDF preview can render the uploaded file without
    // round-tripping through the server.
    const pdfUrl = URL.createObjectURL(file);
    setView({ kind: 'loading', label: 'Extracting… (Claude Sonnet 4.6, ~6–12s)' });

    const form = new FormData();
    form.append('file', file);

    try {
      const res = await fetch('/api/extract', { method: 'POST', body: form });
      const body = (await res.json()) as
        | {
            extraction: VerifiedContractExtraction;
            metadata: ExtractionMetadataShape;
          }
        | { error: { code: string; message: string } };
      if (!res.ok || 'error' in body) {
        const message = 'error' in body ? body.error.message : `Extraction failed (${res.status})`;
        URL.revokeObjectURL(pdfUrl);
        setView({ kind: 'error', message });
        return;
      }
      setView({
        kind: 'extracted',
        sourceLabel: `${file.name} · upload`,
        pdfUrl,
        extraction: body.extraction,
        metadata: body.metadata,
      });
    } catch (err) {
      URL.revokeObjectURL(pdfUrl);
      setView({ kind: 'error', message: err instanceof Error ? err.message : 'Network error' });
    }
  }

  function reset() {
    setView({ kind: 'initial' });
  }

  // ─── Render ────────────────────────────────────────────────────────────

  if (view.kind === 'extracted') {
    return (
      <ExtractionViewer
        extraction={view.extraction}
        metadata={view.metadata}
        pdfUrl={view.pdfUrl}
        sourceLabel={view.sourceLabel}
        onClose={reset}
      />
    );
  }

  return (
    <section className="pt-10 pb-24">
      <div className="label mb-3">Lens</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Document intelligence &mdash; verified.</h1>
      <p className="mt-4 muted text-base leading-relaxed max-w-5xl">
        Upload a contract PDF or pick a sample below. Every extracted field is checked against the source
        page &mdash; anything we can&rsquo;t verify is flagged, not silently passed through.
      </p>

      <h2 className="label mb-2 mt-12">Upload a contract</h2>
      <UploadZone onFile={uploadFile} disabled={view.kind === 'loading'} />

      {view.kind === 'loading' && (
        <div className="loading-state" style={{ marginTop: 16 }}>
          <span className="spinner" aria-hidden="true"></span>
          <span>{view.label}</span>
        </div>
      )}

      {view.kind === 'error' && (
        <div className="error-state" style={{ marginTop: 16 }}>
          <strong>Extraction failed.</strong> {view.message}
        </div>
      )}

      <h2 className="label mt-12 mb-2">Or try an example</h2>
      <SamplePicker samples={samples} onPick={pickSample} />
    </section>
  );
}
