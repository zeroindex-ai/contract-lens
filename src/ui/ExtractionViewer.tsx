'use client';

import { useMemo, useState } from 'react';
import type { MatchQuality, VerifiedDocumentExtraction } from '@/lib/verify';
import { DetailRow, PartiesRow } from './FieldRow';
import { PdfPreview } from './PdfPreview';
import { WarningBanner } from './WarningBanner';
import { buildCitationMarks } from './marks';
import { summarize } from './groups';

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
  extraction: VerifiedDocumentExtraction;
  metadata?: ExtractionMetadataShape;
  pdfUrl: string;
  onClose?: () => void;
  sourceLabel?: string;
}

type Selection = { kind: 'party'; index: number } | { kind: 'detail'; index: number } | null;

export function ExtractionViewer({
  extraction,
  metadata,
  pdfUrl,
  onClose,
  sourceLabel,
}: ExtractionViewerProps) {
  const [selection, setSelection] = useState<Selection>(() => {
    if (extraction.parties.length > 0) return { kind: 'party', index: 0 };
    if (extraction.key_details.length > 0) return { kind: 'detail', index: 0 };
    return null;
  });

  const marks = useMemo(() => buildCitationMarks(extraction), [extraction]);

  const selectedKey =
    selection?.kind === 'party'
      ? `party:${selection.index}`
      : selection?.kind === 'detail'
        ? `detail:${selection.index}`
        : null;

  function selectMark(key: string) {
    if (key.startsWith('party:')) setSelection({ kind: 'party', index: Number(key.slice('party:'.length)) });
    else if (key.startsWith('detail:'))
      setSelection({ kind: 'detail', index: Number(key.slice('detail:'.length)) });
  }

  // Resolve the page to show + hint from the current selection. Jump to
  // verified_page (where the quote actually is) when found, falling back to the
  // claimed page only when it wasn't — so a wrong-page citation still lands the
  // viewer on the real location.
  let page: number | null = null;
  let hint: string | null = null;
  const selected =
    selection?.kind === 'party'
      ? extraction.parties[selection.index]
      : selection?.kind === 'detail'
        ? extraction.key_details[selection.index]
        : null;
  if (selected) {
    page = selected.verified_page ?? selected.evidence_page;
    hint = hintFor(selected.match_quality, selected.evidence_page, selected.verified_page);
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

      {/* document header */}
      <div className="doc-header">
        <h1 className="doc-type">{extraction.document_type}</h1>
        {extraction.summary && <p className="doc-summary">{extraction.summary}</p>}
      </div>

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
        <div className="summary-meter" aria-hidden="true">
          <span style={{ flex: summary.verified, background: 'var(--accent-go)' }}></span>
          <span style={{ flex: summary.review, background: 'var(--error)' }}></span>
        </div>
        <div className="summary-divider"></div>
        <div className="summary-meta">
          {metadata?.model && <span>{metadata.model}</span>}
          <span>
            {metadata?.page_count ? `${metadata.page_count} pages · ` : ''}
            {summary.total} details
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
      </div>

      <WarningBanner verified={extraction} />

      <div className="viewer-split">
        <div className="citations-pane">
          <div className="field-group">
            <div className="group-title">Parties</div>
            <PartiesRow
              parties={extraction.parties}
              selectedIndex={selection?.kind === 'party' ? selection.index : null}
              onSelect={(i) => setSelection({ kind: 'party', index: i })}
            />
          </div>
          <div className="field-group">
            <div className="group-title">Key details</div>
            {extraction.key_details.length === 0 ? (
              <div className="field-row" style={{ cursor: 'default' }}>
                <div className="field-value null">No key details extracted</div>
              </div>
            ) : (
              extraction.key_details.map((detail, i) => (
                <DetailRow
                  key={`${detail.label}-${i}`}
                  detail={detail}
                  selected={selection?.kind === 'detail' && selection.index === i}
                  onSelect={() => setSelection({ kind: 'detail', index: i })}
                />
              ))
            )}
          </div>
        </div>

        <PdfPreview
          pdfUrl={pdfUrl}
          page={page}
          marks={marks}
          selectedKey={selectedKey}
          onSelectMark={selectMark}
          hint={hint}
        />
      </div>

      {metadata && <MetadataFooter metadata={metadata} />}
    </section>
  );
}

function hintFor(matchQuality: MatchQuality, claimed: number, verified: number | null): string | null {
  switch (matchQuality) {
    case 'wrong-page':
      return verified !== null ? `Quote claimed on p. ${claimed}, found on p. ${verified}` : 'Quote on a different page';
    case 'not-found':
      return 'Quote not found in the PDF';
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
