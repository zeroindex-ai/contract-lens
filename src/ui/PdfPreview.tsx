'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Renders one page of a PDF to a canvas, plus a quote panel below.
 *
 * Uses pdfjs-dist's legacy build so we don't need to wire a Web Worker —
 * page count and per-page render are fast enough for our 1–3 page samples
 * that the main-thread cost is invisible.
 *
 * The PDF document is fetched lazily and cached per `pdfUrl` so switching
 * between fields on the same document doesn't re-fetch.
 */

export interface PdfPreviewProps {
  pdfUrl: string | null;
  /** 1-indexed; the page the selected field's evidence points at. */
  page: number | null;
  /** The verbatim quote to display below the page render. */
  quote: string | null;
  /** Optional human-readable hint about why this page (e.g. "wrong page" / "not found"). */
  hint?: string | null;
}

interface PdfDocProxy {
  numPages: number;
  getPage(n: number): Promise<PdfPageProxy>;
  destroy(): Promise<void>;
}
interface PdfPageProxy {
  getViewport(args: { scale: number }): { width: number; height: number };
  render(args: { canvasContext: CanvasRenderingContext2D; viewport: { width: number; height: number } }): {
    promise: Promise<void>;
  };
  cleanup(): void;
}

const pdfCache = new Map<string, Promise<PdfDocProxy>>();

async function loadPdf(pdfUrl: string): Promise<PdfDocProxy> {
  if (!pdfCache.has(pdfUrl)) {
    pdfCache.set(
      pdfUrl,
      (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const pdfjs: any = await import('pdfjs-dist/legacy/build/pdf.mjs');
        const data = await fetch(pdfUrl).then((r) => r.arrayBuffer());
        const loadingTask = pdfjs.getDocument({
          data,
          disableWorker: true,
          isEvalSupported: false,
          useSystemFonts: true,
        });
        return loadingTask.promise as Promise<PdfDocProxy>;
      })()
    );
  }
  return pdfCache.get(pdfUrl)!;
}

export function PdfPreview({ pdfUrl, page, quote, hint }: PdfPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [pageCount, setPageCount] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  // `shownPage` mirrors the `page` prop unless the user navigated manually.
  // We track the prop value alongside it so we can detect prop changes and
  // reset the manual override during render (rather than in an effect, which
  // would trigger React 19's set-state-in-effect rule).
  const [shownPage, setShownPage] = useState<number | null>(page);
  const [lastPropPage, setLastPropPage] = useState<number | null>(page);
  const [lastPdfUrl, setLastPdfUrl] = useState<string | null>(pdfUrl);
  if (lastPropPage !== page || lastPdfUrl !== pdfUrl) {
    setLastPropPage(page);
    setLastPdfUrl(pdfUrl);
    setShownPage(page);
  }

  // Load + render whenever pdfUrl or shownPage changes.
  useEffect(() => {
    let cancelled = false;

    if (!pdfUrl || shownPage === null) return;

    (async () => {
      try {
        const doc = await loadPdf(pdfUrl);
        if (cancelled) return;
        setPageCount(doc.numPages);

        const targetPage = Math.max(1, Math.min(shownPage, doc.numPages));
        const pageObj = await doc.getPage(targetPage);
        if (cancelled) return;

        const canvas = canvasRef.current;
        if (!canvas) return;

        // Render at 1.5× for crispness; matches the cream/print aesthetic.
        const viewport = pageObj.getViewport({ scale: 1.5 });
        const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
        canvas.width = viewport.width * dpr;
        canvas.height = viewport.height * dpr;
        canvas.style.width = '100%';
        canvas.style.height = 'auto';

        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        await pageObj.render({
          canvasContext: ctx,
          viewport: { width: viewport.width, height: viewport.height },
        }).promise;
        pageObj.cleanup();
        if (!cancelled) setError(null);
      } catch (err) {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : 'Failed to render PDF page');
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [pdfUrl, shownPage]);

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
        <canvas ref={canvasRef} aria-label={`PDF page ${shownPage} of ${pageCount}`} />
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
