'use client';

import { useEffect, useRef, useState } from 'react';
import { normalize } from '@/lib/match';

/**
 * Renders one page of a PDF to a canvas with a transparent pdfjs text layer
 * overlaid on top. When a `quote` is supplied, the spans of the text layer
 * that fall within the quote's character range are highlighted in place —
 * the real version of the mockup's "highlight on the page".
 *
 * Worker: the pdfjs web worker is copied to /pdf.worker.min.mjs by the
 * predev/prebuild script (scripts/copy-pdf-worker.mjs) so it always matches
 * the installed pdfjs-dist version. We set GlobalWorkerOptions.workerSrc once.
 *
 * The PDF document is fetched + parsed lazily and cached per `pdfUrl` so
 * switching fields on the same document doesn't re-fetch.
 */

export interface PdfPreviewProps {
  pdfUrl: string | null;
  /** 1-indexed; the page the selected field's evidence points at. */
  page: number | null;
  /** The verbatim quote to highlight + display. */
  quote: string | null;
  /** Optional human-readable hint (e.g. "wrong page" / "not found"). */
  hint?: string | null;
}

const SCALE = 1.6;

/* eslint-disable @typescript-eslint/no-explicit-any */
let pdfjsPromise: Promise<any> | null = null;
async function getPdfjs(): Promise<any> {
  if (!pdfjsPromise) {
    pdfjsPromise = (async () => {
      const pdfjs = await import('pdfjs-dist');
      pdfjs.GlobalWorkerOptions.workerSrc = '/pdf.worker.min.mjs';
      return pdfjs;
    })();
  }
  return pdfjsPromise;
}

const docCache = new Map<string, Promise<any>>();
async function loadPdf(pdfUrl: string): Promise<any> {
  if (!docCache.has(pdfUrl)) {
    docCache.set(
      pdfUrl,
      (async () => {
        const pdfjs = await getPdfjs();
        const data = await fetch(pdfUrl).then((r) => r.arrayBuffer());
        return pdfjs.getDocument({ data, isEvalSupported: false }).promise;
      })()
    );
  }
  return docCache.get(pdfUrl)!;
}
/* eslint-enable @typescript-eslint/no-explicit-any */

/** normalize() + strip ALL whitespace, so the match doesn't depend on where
 *  pdfjs happened to split text items (it splits mid-phrase, so any inserted
 *  separator would break a substring match). */
function dense(s: string): string {
  return normalize(s).replace(/\s+/g, '');
}

/**
 * Highlight the text-layer spans that overlap the quote's character range.
 * Both sides are dense-normalized (lowercase, quotes/dashes folded, ALL
 * whitespace removed) so PDF extraction quirks and arbitrary span splits
 * don't break the match.
 */
function highlightQuote(container: HTMLElement, quote: string): boolean {
  container.querySelectorAll('span.hl').forEach((el) => el.classList.remove('hl'));
  const spans = Array.from(container.querySelectorAll('span')).filter((s) => s.childElementCount === 0);

  let joined = '';
  const ranges: { el: HTMLElement; start: number; end: number }[] = [];
  for (const el of spans) {
    const t = dense(el.textContent ?? '');
    if (!t) continue;
    const start = joined.length;
    joined += t;
    ranges.push({ el: el as HTMLElement, start, end: joined.length });
  }

  const q = dense(quote);
  if (!q) return false;
  const idx = joined.indexOf(q);
  if (idx < 0) return false;

  const qEnd = idx + q.length;
  let first: HTMLElement | null = null;
  for (const r of ranges) {
    if (r.start < qEnd && r.end > idx) {
      r.el.classList.add('hl');
      if (!first) first = r.el;
    }
  }
  if (first) first.scrollIntoView({ block: 'center', behavior: 'smooth' });
  return true;
}

export function PdfPreview({ pdfUrl, page, quote, hint }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // `shownPage` mirrors `page` unless the user navigated manually. Prop changes
  // reset the override during render (not in an effect — avoids React 19's
  // set-state-in-effect rule).
  const [shownPage, setShownPage] = useState<number | null>(page);
  const [lastPropPage, setLastPropPage] = useState<number | null>(page);
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(pdfUrl);
  if (lastPropPage !== page || lastPdfUrl !== pdfUrl) {
    setLastPropPage(page);
    setLastPdfUrl(pdfUrl);
    setShownPage(page);
  }

  useEffect(() => {
    let cancelled = false;
    if (!pdfUrl || shownPage === null) return;

    (async () => {
      try {
        const pdfjs = await getPdfjs();
        const doc = await loadPdf(pdfUrl);
        if (cancelled) return;
        setPageCount(doc.numPages);

        const targetPage = Math.max(1, Math.min(shownPage, doc.numPages));
        const pageObj = await doc.getPage(targetPage);
        if (cancelled) return;

        const viewport = pageObj.getViewport({ scale: SCALE });
        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;
        if (!canvas || !textLayerDiv) return;

        // ── canvas (page image) ──
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${viewport.width}px`;
        canvas.style.height = `${viewport.height}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await pageObj.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        // ── transparent text layer overlay ──
        textLayerDiv.innerHTML = '';
        textLayerDiv.style.width = `${viewport.width}px`;
        textLayerDiv.style.height = `${viewport.height}px`;
        textLayerDiv.style.setProperty('--scale-factor', String(SCALE));
        const textContent = await pageObj.getTextContent();
        if (cancelled) return;
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
        if (cancelled) return;

        if (quote) highlightQuote(textLayerDiv, quote);
        pageObj.cleanup();
        setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to render PDF page');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl, shownPage, quote]);

  if (!pdfUrl) {
    return (
      <div className="pdf-preview">
        <div className="empty-state">No PDF loaded.</div>
      </div>
    );
  }

  const canPrev = shownPage !== null && shownPage > 1;
  const canNext = shownPage !== null && shownPage < pageCount;

  return (
    <div className="pdf-preview">
      <div className="page-bar">
        <div className="nav">
          <button type="button" onClick={() => setShownPage((p) => (p ?? 1) - 1)} disabled={!canPrev}>
            ←
          </button>
          <span>
            page {shownPage ?? '—'} of {pageCount || '—'}
          </span>
          <button type="button" onClick={() => setShownPage((p) => (p ?? 1) + 1)} disabled={!canNext}>
            →
          </button>
        </div>
        {hint && <span style={{ color: 'var(--warn)' }}>{hint}</span>}
      </div>
      <div className="pdf-canvas-wrap">
        <div className="pdf-stage">
          <canvas ref={canvasRef} aria-label={`PDF page ${shownPage} of ${pageCount}`} />
          <div className="textLayer" ref={textLayerRef} aria-hidden="true" />
        </div>
      </div>
      {error && (
        <div className="error-state" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      {quote && (
        <div className="pdf-quote">
          &ldquo;{quote}&rdquo;
          <div className="quote-meta">Model&rsquo;s evidence quote</div>
        </div>
      )}
    </div>
  );
}
