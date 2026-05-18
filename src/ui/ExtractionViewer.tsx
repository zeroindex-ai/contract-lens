'use client';

import { useState } from 'react';
import type { VerifiedContractExtraction } from '@/lib/verify';
import { SCALAR_FIELD_KEYS, type ScalarFieldKey } from '@/schema/extraction';
import { FieldRow, PartiesRow } from './FieldRow';
import { PdfPreview } from './PdfPreview';
import { WarningBanner } from './WarningBanner';

export interface ExtractionMetadataShape {
  id?: string;
  page_count?: number;
  model?: string;
  latency_ms?: number;
  input_tokens?: number;
  output_tokens?: number;
  trace_id?: string | null;
}

export interface ExtractionViewerProps {
  extraction: VerifiedContractExtraction;
  metadata?: ExtractionMetadataShape;
  pdfUrl: string;
  /** Called when the user clicks "back" — clears selection at the parent shell. */
  onClose?: () => void;
  /** Optional source label (e.g. "Mutual NDA · sample") shown in the heading. */
  sourceLabel?: string;
}

type Selection =
  | { kind: 'party'; index: number }
  | { kind: 'field'; key: ScalarFieldKey }
  | null;

export function ExtractionViewer({
  extraction,
  metadata,
  pdfUrl,
  onClose,
  sourceLabel,
}: ExtractionViewerProps) {
  // Default selection: first party (if any), else first scalar field with a quote.
  // Lazy useState init keeps this computation off the render path for re-renders.
  const [selection, setSelection] = useState<Selection>(() => {
    if (extraction.parties.length > 0) return { kind: 'party', index: 0 };
    for (const key of SCALAR_FIELD_KEYS) {
      if (extraction[key].evidence_quote !== null) return { kind: 'field', key };
    }
    return null;
  });

  // Resolve current page + quote + hint from the selection. Pure derivation —
  // React 19's compiler memoizes this automatically; no useMemo needed.
  let page: number | null = null;
  let quote: string | null = null;
  let hint: string | null = null;
  if (selection?.kind === 'party') {
    const p = extraction.parties[selection.index];
    page = p.evidence_page;
    quote = p.evidence_quote;
    hint = hintFor(p.match_quality);
  } else if (selection?.kind === 'field') {
    const f = extraction[selection.key];
    if (f.match_quality === 'null-field') {
      page = 1;
      quote = null;
      hint = 'Field not present in this contract';
    } else {
      page = f.evidence_page;
      quote = f.evidence_quote;
      hint = hintFor(f.match_quality);
    }
  }

  return (
    <section className="pt-6 pb-24">
      {onClose && (
        <button type="button" className="back-link" onClick={onClose}>
          ← back to samples
        </button>
      )}

      {sourceLabel && (
        <div className="label mb-3" style={{ color: 'var(--muted-2)' }}>
          {sourceLabel}
        </div>
      )}

      <WarningBanner verified={extraction} />

      <div className="viewer-split">
        <div>
          <PartiesRow
            parties={extraction.parties}
            selectedIndex={selection?.kind === 'party' ? selection.index : null}
            onSelect={(i) => setSelection({ kind: 'party', index: i })}
          />
          {SCALAR_FIELD_KEYS.map((key) => (
            <FieldRow
              key={key}
              fieldKey={key}
              field={extraction[key]}
              selected={selection?.kind === 'field' && selection.key === key}
              onSelect={() => setSelection({ kind: 'field', key })}
            />
          ))}
        </div>

        <PdfPreview pdfUrl={pdfUrl} page={page} quote={quote} hint={hint} />
      </div>

      {metadata && <MetadataFooter metadata={metadata} />}
    </section>
  );
}

function hintFor(matchQuality: string): string | null {
  switch (matchQuality) {
    case 'wrong-page':
      return 'Quote was on a different page than claimed';
    case 'not-found':
      return 'Quote not found in the PDF — possible hallucination';
    case 'incomplete':
      return 'Field was partially returned';
    default:
      return null;
  }
}

function MetadataFooter({ metadata }: { metadata: ExtractionMetadataShape }) {
  return (
    <div className="metadata-footer">
      {metadata.model && (
        <span>
          <strong>Model</strong>
          {metadata.model}
        </span>
      )}
      {metadata.latency_ms !== undefined && (
        <span>
          <strong>Latency</strong>
          {(metadata.latency_ms / 1000).toFixed(2)}s
        </span>
      )}
      {metadata.page_count !== undefined && (
        <span>
          <strong>Pages</strong>
          {metadata.page_count}
        </span>
      )}
      {(metadata.input_tokens !== undefined || metadata.output_tokens !== undefined) && (
        <span>
          <strong>Tokens</strong>
          {metadata.input_tokens ?? '?'} in / {metadata.output_tokens ?? '?'} out
        </span>
      )}
      {metadata.trace_id && (
        <span>
          <strong>Trace</strong>
          {metadata.trace_id}
        </span>
      )}
    </div>
  );
}
