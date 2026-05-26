'use client';

import './pdf-polyfills'; // Promise.withResolvers for iOS Safari < 17.4 — must load before pdfjs
import { useEffect, useRef, useState, type MouseEvent } from 'react';
import type { CitationMark } from './marks';
import { buildSpanRanges, matchQuote } from './highlight';

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
  /** All locatable citations across the document; the ones on the visible page are highlighted. */
  marks: CitationMark[];
  /** Key of the currently-selected citation (emphasized + scrolled into view). */
  selectedKey: string | null;
  /** Clicking a highlight on the page selects that citation. */
  onSelectMark?: (key: string) => void;
  /** Optional human-readable hint (e.g. "wrong page" / "not found"). */
  hint?: string | null;
}

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

const HL_CLASSES = ['hl', 'hl-selected'];

const ZOOM_MIN = 0.5;
const ZOOM_MAX = 3;
const ZOOM_STEP = 0.25;

/**
 * Highlight every supplied citation's spans in the text layer and tag them with
 * the citation key so clicks can map back to a field. The selected citation
 * also gets the `hl-selected` ring; its first span is returned so the caller
 * can scroll it into view.
 *
 * Both sides are dense-normalized (lowercase, quotes/dashes folded, ALL
 * whitespace removed) so PDF extraction quirks and arbitrary span splits don't
 * break the match.
 */
function highlightMarks(
  container: HTMLElement,
  marks: CitationMark[],
  selectedKey: string | null
): HTMLElement | null {
  container.querySelectorAll('span.hl').forEach((el) => {
    el.classList.remove(...HL_CLASSES);
    delete (el as HTMLElement).dataset.markKey;
  });

  const spans = Array.from(container.querySelectorAll('span')).filter(
    (s) => s.childElementCount === 0
  ) as HTMLElement[];
  const { joined, ranges } = buildSpanRanges(spans.map((el) => el.textContent ?? ''));

  let firstSelected: HTMLElement | null = null;
  for (const mark of marks) {
    const { spanIndices } = matchQuote(mark.quote, joined, ranges);
    if (spanIndices.length === 0) continue;
    const isSelected = mark.key === selectedKey;
    for (const idx of spanIndices) {
      const el = spans[idx];
      if (!el) continue;
      el.classList.add('hl');
      el.dataset.markKey = mark.key;
      if (isSelected) {
        el.classList.add('hl-selected');
        if (!firstSelected) firstSelected = el;
      }
    }
  }
  return firstSelected;
}

/**
 * Scroll ONLY the given scroll container so `el` is centered. Avoids
 * element.scrollIntoView(), which scrolls every scrollable ancestor (incl.
 * the window) and can yank the whole page to the top.
 */
function centerInContainer(container: HTMLElement, el: HTMLElement): void {
  const cRect = container.getBoundingClientRect();
  const eRect = el.getBoundingClientRect();
  const target = container.scrollTop + (eRect.top - cRect.top) - container.clientHeight / 2 + eRect.height / 2;
  container.scrollTo({ top: Math.max(0, target), behavior: 'smooth' });
}

export function PdfPreview({ pdfUrl, page, marks, selectedKey, onSelectMark, hint }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const textLayerRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);
  // Zoom multiplies the fit-to-width scale. >1 makes the canvas wider than the
  // wrap, which the wrap's overflow:auto turns into a horizontal scrollbar.
  const [zoom, setZoom] = useState(1);

  // `shownPage` mirrors `page` unless the user navigated manually. Prop changes
  // reset the override during render (not in an effect — avoids React 19's
  // set-state-in-effect rule).
  const [shownPage, setShownPage] = useState<number | null>(page);
  const [lastPropPage, setLastPropPage] = useState<number | null>(page);
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(pdfUrl);
  if (lastPropPage !== page || lastPdfUrl !== pdfUrl) {
    if (lastPdfUrl !== pdfUrl) setZoom(1); // reset zoom when a new document loads
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

        const canvas = canvasRef.current;
        const textLayerDiv = textLayerRef.current;
        const stage = stageRef.current;
        if (!canvas || !textLayerDiv || !stage) return;

        // ── scale to fit the container width ──
        // The canvas and text layer MUST share one coordinate space, or the
        // transparent text spans drift from the rendered glyphs and highlights
        // land on blank areas. We render at the container's pixel width (not
        // the PDF's natural width) so display size == text-layer size exactly.
        const containerWidth = (stage.parentElement?.clientWidth ?? stage.clientWidth) || 480;
        const unscaled = pageObj.getViewport({ scale: 1 });
        // Fit-to-width at zoom 1; zoom multiplies, overflowing the wrap (→ scroll).
        const scale = (containerWidth / unscaled.width) * zoom;
        const viewport = pageObj.getViewport({ scale });

        // ── canvas (page image), backing store at DPR for crispness ──
        const dpr = window.devicePixelRatio || 1;
        canvas.width = Math.floor(viewport.width * dpr);
        canvas.height = Math.floor(viewport.height * dpr);
        canvas.style.width = `${Math.floor(viewport.width)}px`;
        canvas.style.height = `${Math.floor(viewport.height)}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await pageObj.render({ canvasContext: ctx, viewport }).promise;
        if (cancelled) return;

        // ── transparent text layer overlay, same dimensions + scale ──
        textLayerDiv.replaceChildren();
        textLayerDiv.style.width = `${Math.floor(viewport.width)}px`;
        textLayerDiv.style.height = `${Math.floor(viewport.height)}px`;
        textLayerDiv.style.setProperty('--scale-factor', String(scale));
        const textContent = await pageObj.getTextContent();
        if (cancelled) return;
        const textLayer = new pdfjs.TextLayer({
          textContentSource: textContent,
          container: textLayerDiv,
          viewport,
        });
        await textLayer.render();
        if (cancelled) return;

        const onThisPage = marks.filter((m) => m.page === targetPage);
        const firstHl = highlightMarks(textLayerDiv, onThisPage, selectedKey);
        if (firstHl && wrapRef.current) {
          const wrap = wrapRef.current;
          // rAF so layout is settled before measuring; only the PDF panel scrolls.
          requestAnimationFrame(() => centerInContainer(wrap, firstHl));
        }
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
  }, [pdfUrl, shownPage, marks, selectedKey, zoom]);

  if (!pdfUrl) {
    return (
      <div className="pdf-preview">
        <div className="empty-state">No PDF loaded.</div>
      </div>
    );
  }

  const canPrev = shownPage !== null && shownPage > 1;
  const canNext = shownPage !== null && shownPage < pageCount;
  const selectedQuote = marks.find((m) => m.key === selectedKey)?.quote ?? null;
  const onPageCount = shownPage === null ? 0 : marks.filter((m) => m.page === shownPage).length;

  function handleLayerClick(e: MouseEvent<HTMLDivElement>) {
    if (!onSelectMark) return;
    const span = (e.target as HTMLElement).closest('span[data-mark-key]') as HTMLElement | null;
    const key = span?.dataset.markKey;
    if (key) onSelectMark(key);
  }

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
        <div className="zoom" aria-label="Zoom">
          <button
            type="button"
            onClick={() => setZoom((z) => Math.max(ZOOM_MIN, +(z - ZOOM_STEP).toFixed(2)))}
            disabled={zoom <= ZOOM_MIN}
            aria-label="Zoom out"
          >
            &minus;
          </button>
          <button
            type="button"
            className="pct"
            onClick={() => setZoom(1)}
            disabled={zoom === 1}
            title="Reset to 100%"
            aria-label="Reset zoom to 100%"
          >
            {Math.round(zoom * 100)}%
          </button>
          <button
            type="button"
            onClick={() => setZoom((z) => Math.min(ZOOM_MAX, +(z + ZOOM_STEP).toFixed(2)))}
            disabled={zoom >= ZOOM_MAX}
            aria-label="Zoom in"
          >
            +
          </button>
        </div>
      </div>
      <div className="citation-hint">
        {onPageCount > 0 ? (
          <>
            <span className="count">
              {onPageCount} citation{onPageCount === 1 ? '' : 's'}
            </span>{' '}
            highlighted on this page &mdash; click any to inspect it
          </>
        ) : (
          'No citations on this page'
        )}
      </div>
      <div className="pdf-canvas-wrap" ref={wrapRef}>
        <div className="pdf-stage" ref={stageRef}>
          <canvas ref={canvasRef} aria-label={`PDF page ${shownPage} of ${pageCount}`} />
          <div className="textLayer" ref={textLayerRef} aria-hidden="true" onClick={handleLayerClick} />
        </div>
      </div>
      {error && (
        <div className="error-state" style={{ marginTop: 12 }}>
          {error}
        </div>
      )}
      {selectedQuote && (
        <div className="pdf-quote">
          &ldquo;{selectedQuote}&rdquo;
          <div className="quote-meta">Model&rsquo;s evidence quote</div>
        </div>
      )}
    </div>
  );
}
