'use client';

import { useMemo, useRef, useState } from 'react';
import type { MatchQuality, VerifiedDocumentExtraction } from '@/lib/verify';
import { DetailRow, PartiesRow } from './FieldRow';
import { PdfPreview } from './PdfPreview';
import { WarningBanner } from './WarningBanner';
import { buildCitationMarks } from './marks';
import { summarize } from './groups';
import { downloadXlsx, downloadPdf } from './export';

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
  const detailCount = extraction.key_details.length;
  const hasItems = extraction.parties.length + detailCount > 0;
  // Guard against double-clicks without a visible busy state — exports are
  // near-instant, so a loading indicator just flashes. Refs avoid re-renders.
  const pdfBusy = useRef(false);
  const xlsxBusy = useRef(false);

  async function exportPdf() {
    if (pdfBusy.current) return;
    pdfBusy.current = true;
    try {
      await downloadPdf(extraction);
    } finally {
      pdfBusy.current = false;
    }
  }

  async function exportXlsx() {
    if (xlsxBusy.current) return;
    xlsxBusy.current = true;
    try {
      await downloadXlsx(extraction);
    } finally {
      xlsxBusy.current = false;
    }
  }

  return (
    <section className="pt-6 pb-24">
      <div className="viewer-toolbar">
        {onClose ? (
          <button type="button" className="back-link" onClick={onClose}>
            &larr; BACK TO SAMPLES
          </button>
        ) : (
          <span />
        )}
        {hasItems && (
          <div className="export-actions">
            <span className="export-label">Export</span>
            <button type="button" className="export-btn" onClick={exportXlsx}>
              Excel
            </button>
            <button type="button" className="export-btn" onClick={exportPdf}>
              PDF
            </button>
          </div>
        )}
      </div>
      {/* Document header: identity + verification, closed off by a hairline rule. */}
      <header className="doc-header">
        <div className="doc-header-top">
          <div className="doc-header-id">
            {sourceLabel && <div className="source-line">{sourceLabel}</div>}
            <h1 className="doc-type">{extraction.document_type}</h1>
          </div>
          <div className="doc-header-status">
            <div className={`verify-status ${summary.review === 0 ? 'ok' : 'warn'}`}>
              <span className="dot" aria-hidden="true"></span>
              {summary.review === 0 ? 'Fully verified' : `${summary.review} flagged for review`}
            </div>
            <div className="doc-header-meta">
              {detailCount} {detailCount === 1 ? 'detail' : 'details'}
              {metadata?.page_count
                ? ` · ${metadata.page_count} ${metadata.page_count === 1 ? 'page' : 'pages'}`
                : ''}
              {metadata?.model ? ` · ${metadata.model}` : ''}
            </div>
          </div>
        </div>
        {extraction.summary && <p className="doc-summary">{extraction.summary}</p>}
      </header>

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

      <div className="legend viewer-legend">
        <span className="legend-item">
          <span className="legend-dot dot-green"></span> verified
        </span>
        <span className="legend-item">
          <span className="legend-dot dot-amber"></span> low confidence
        </span>
        <span className="legend-item">
          <span className="legend-dot dot-red"></span> not verified
        </span>
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
        <span className="meta-item">
          <span className="meta-k">Model:</span> {metadata.model}
        </span>
      )}
      {metadata.latency_ms !== undefined && (
        <span className="meta-item">
          <span className="meta-k">Latency:</span> {(metadata.latency_ms / 1000).toFixed(2)}s
        </span>
      )}
      {(metadata.input_tokens !== undefined || metadata.output_tokens !== undefined) && (
        <span className="meta-item">
          <span className="meta-k">Tokens:</span> {metadata.input_tokens ?? '?'} in / {metadata.output_tokens ?? '?'} out
        </span>
      )}
      {metadata.trace_id && (
        <span className="meta-item">
          <span className="meta-k">Trace:</span> {metadata.trace_id}
        </span>
      )}
    </div>
  );
}
