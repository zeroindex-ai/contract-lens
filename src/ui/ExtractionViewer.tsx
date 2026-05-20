'use client';

import { useState } from 'react';
import type { VerifiedContractExtraction } from '@/lib/verify';
import type { ScalarFieldKey } from '@/schema/extraction';
import { FieldRow, PartiesRow } from './FieldRow';
import { PdfPreview } from './PdfPreview';
import { WarningBanner } from './WarningBanner';
import { FIELD_GROUPS, summarize } from './groups';

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
  onClose?: () => void;
  sourceLabel?: string;
}

type Selection = { kind: 'party'; index: number } | { kind: 'field'; key: ScalarFieldKey } | null;

export function ExtractionViewer({
  extraction,
  metadata,
  pdfUrl,
  onClose,
  sourceLabel,
}: ExtractionViewerProps) {
  const [selection, setSelection] = useState<Selection>(() => {
    if (extraction.parties.length > 0) return { kind: 'party', index: 0 };
    for (const g of FIELD_GROUPS) {
      for (const key of g.fields) {
        if (extraction[key].evidence_quote !== null) return { kind: 'field', key };
      }
    }
    return null;
  });

  // Resolve the page to show + quote + hint from the current selection.
  // Key rule: jump to `verified_page` (where the quote actually is) when it
  // exists, falling back to the model's claimed `evidence_page` only when the
  // quote wasn't found anywhere — so wrong-page citations land the viewer on
  // the real location and the highlight can hit.
  let page: number | null = null;
  let quote: string | null = null;
  let hint: string | null = null;
  if (selection?.kind === 'party') {
    const p = extraction.parties[selection.index];
    page = p.verified_page ?? p.evidence_page;
    quote = p.evidence_quote;
    hint = hintFor(p.match_quality, p.evidence_page, p.verified_page);
  } else if (selection?.kind === 'field') {
    const f = extraction[selection.key];
    if (f.match_quality === 'null-field') {
      page = 1;
      quote = null;
      hint = 'Field not present in this contract';
    } else {
      page = f.verified_page ?? f.evidence_page;
      quote = f.evidence_quote;
      hint = hintFor(f.match_quality, f.evidence_page, f.verified_page);
    }
  }

  const summary = summarize(extraction);

  return (
    <section className="pt-6 pb-24">
      {onClose && (
        <button type="button" className="back-link" onClick={onClose}>
          &larr; BACK TO SAMPLES
        </button>
      )}
      {sourceLabel && <div className="source-line">{sourceLabel}</div>}

      {/* summary strip */}
      <div className="summary-strip">
        <div className="stat">
          <span className="n" style={{ color: 'var(--accent-go)' }}>
            {summary.verified}
          </span>
          <span className="k">verified</span>
        </div>
        <div className="stat">
          <span className="n" style={{ color: summary.review > 0 ? 'var(--error)' : 'var(--muted-2)' }}>
            {summary.review}
          </span>
          <span className="k">needs review</span>
        </div>
        <div className="stat">
          <span className="n" style={{ color: 'var(--muted-2)' }}>
            {summary.notInContract}
          </span>
          <span className="k">not in contract</span>
        </div>
        <div className="summary-meter" aria-hidden="true">
          <span style={{ flex: summary.verified, background: 'var(--accent-go)' }}></span>
          <span style={{ flex: summary.review, background: 'var(--error)' }}></span>
          <span style={{ flex: summary.notInContract, background: 'var(--muted-2)' }}></span>
        </div>
        <div className="summary-divider"></div>
        <div className="summary-meta">
          {metadata?.model && <span>{metadata.model}</span>}
          <span>
            {metadata?.page_count ? `${metadata.page_count} pages · ` : ''}
            {summary.total} fields
          </span>
        </div>
      </div>

      {/* legend */}
      <div className="legend">
        <span className="legend-item">
          <span className="legend-dot dot-green"></span> verified &mdash; quote found on the cited page
        </span>
        <span className="legend-item">
          <span className="legend-dot dot-amber"></span> low confidence
        </span>
        <span className="legend-item">
          <span className="legend-dot dot-red"></span> not verified
        </span>
        <span className="legend-item">
          <span className="legend-dot dot-gray"></span> not in contract
        </span>
      </div>

      <WarningBanner verified={extraction} />

      <div className="viewer-split">
        <div className="citations-pane">
          {FIELD_GROUPS.map((g) => (
            <div className="field-group" key={g.title}>
              <div className="group-title">{g.title}</div>
              {g.includesParties && (
                <PartiesRow
                  parties={extraction.parties}
                  selectedIndex={selection?.kind === 'party' ? selection.index : null}
                  onSelect={(i) => setSelection({ kind: 'party', index: i })}
                />
              )}
              {g.fields.map((key) => (
                <FieldRow
                  key={key}
                  fieldKey={key}
                  field={extraction[key]}
                  selected={selection?.kind === 'field' && selection.key === key}
                  onSelect={() => setSelection({ kind: 'field', key })}
                />
              ))}
            </div>
          ))}
        </div>

        <PdfPreview pdfUrl={pdfUrl} page={page} quote={quote} hint={hint} />
      </div>

      {metadata && <MetadataFooter metadata={metadata} />}
    </section>
  );
}

function hintFor(matchQuality: string, claimed: number | null, verified: number | null): string | null {
  switch (matchQuality) {
    case 'wrong-page':
      return verified !== null ? `Quote claimed on p. ${claimed}, found on p. ${verified}` : 'Quote on a different page';
    case 'not-found':
      return 'Quote not found in the PDF';
    case 'incomplete':
      return 'Field partially returned';
    default:
      return null;
  }
}

function MetadataFooter({ metadata }: { metadata: ExtractionMetadataShape }) {
  const hasAny =
    metadata.model ||
    metadata.latency_ms !== undefined ||
    metadata.input_tokens !== undefined ||
    metadata.trace_id;
  if (!hasAny) return null;
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
