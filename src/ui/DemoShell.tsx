'use client';

import { useEffect, useState } from 'react';
import type { VerifiedContractExtraction } from '@/lib/verify';
import { SamplePicker, type SampleManifestEntry } from './SamplePicker';
import { UploadZone } from './UploadZone';
import { ExtractionViewer, type ExtractionMetadataShape } from './ExtractionViewer';
import {
  saveSession,
  loadSession,
  clearSession,
  arrayBufferToBase64,
  base64ToBlob,
} from './session-store';

export interface DemoShellProps {
  samples: SampleManifestEntry[];
}

type ViewState =
  | { kind: 'initial' }
  | { kind: 'loading'; label: string }
  | { kind: 'error'; message: string; code?: string }
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
      saveSession({ kind: 'sample', sampleId: sample.id });
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
        const code = 'error' in body ? body.error.code : undefined;
        URL.revokeObjectURL(pdfUrl);
        setView({ kind: 'error', message, code });
        return;
      }
      setView({
        kind: 'extracted',
        sourceLabel: `${file.name} · upload`,
        pdfUrl,
        extraction: body.extraction,
        metadata: body.metadata,
      });
      // Persist so a refresh restores the viewer without a second extraction call.
      try {
        const buf = await file.arrayBuffer();
        saveSession({
          kind: 'upload',
          sourceLabel: `${file.name} · upload`,
          extraction: body.extraction,
          metadata: body.metadata,
          pdfBase64: arrayBufferToBase64(buf),
        });
      } catch {
        // Couldn't read/encode the file for persistence — non-fatal.
      }
    } catch (err) {
      URL.revokeObjectURL(pdfUrl);
      setView({ kind: 'error', message: err instanceof Error ? err.message : 'Network error' });
    }
  }

  function reset() {
    clearSession();
    setView({ kind: 'initial' });
  }

  // Restore the last-viewed document on mount so a refresh keeps the user on the
  // viewer (selection resets to default — only the document is persisted). This
  // is a deliberate one-time post-hydration restore: sessionStorage is
  // client-only and the sample path is async, so it can't be render-time state.
  /* eslint-disable react-hooks/set-state-in-effect -- intentional one-shot restore of the persisted document */
  useEffect(() => {
    const saved = loadSession();
    if (!saved) return;
    if (saved.kind === 'sample') {
      const sample = samples.find((s) => s.id === saved.sampleId);
      if (sample) void pickSample(sample);
      return;
    }
    const pdfUrl = URL.createObjectURL(base64ToBlob(saved.pdfBase64));
    setView({
      kind: 'extracted',
      sourceLabel: saved.sourceLabel,
      pdfUrl,
      extraction: saved.extraction,
      metadata: saved.metadata,
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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

      {view.kind === 'error' &&
        (view.code === 'RATE_LIMITED' ? (
          <div className="demo-notice" style={{ marginTop: 16 }}>
            {view.message}
          </div>
        ) : (
          <div className="error-state" style={{ marginTop: 16 }}>
            <strong>Extraction failed.</strong> {view.message}
          </div>
        ))}

      <h2 className="label mt-12 mb-2">Or try an example</h2>
      <SamplePicker samples={samples} onPick={pickSample} />
    </section>
  );
}
