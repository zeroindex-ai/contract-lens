/**
 * Extract per-page text from a PDF buffer, server-side.
 *
 * Uses `unpdf` rather than pdfjs-dist directly: unpdf bundles a worker-free,
 * serverless-compatible build of pdf.js, which sidesteps the worker-module
 * resolution problems that break a raw pdfjs-dist import in a Vercel function
 * (it dynamically imports pdf.worker.mjs, which the file tracer can't follow,
 * and force-including it pulls symlinked pnpm files Vercel can't package).
 *
 * Two outputs:
 *   - `pageTexts[i]` — text for page (i+1), used by the verification layer to
 *     match the model's evidence_quote
 *   - `pageCount` — used by the upload guard to enforce the ≤50 page cap before
 *     paying for an Anthropic call
 */

export interface PdfTextResult {
  pageCount: number;
  pageTexts: string[];
}

/**
 * Extract per-page text from a PDF. Throws if the buffer isn't a valid PDF
 * (callers should map that to a 4xx NOT_A_PDF response).
 *
 * Passes a copy to unpdf — the underlying pdfjs detaches/transfers the
 * ArrayBuffer it parses, which would leave the caller's buffer empty for the
 * downstream base64 (Anthropic) + sha256 (persistence) steps.
 */
export async function extractPdfText(pdfBuffer: Uint8Array): Promise<PdfTextResult> {
  const { getDocumentProxy, extractText } = await import('unpdf');
  const doc = await getDocumentProxy(new Uint8Array(pdfBuffer));
  const { totalPages, text } = await extractText(doc, { mergePages: false });
  // mergePages:false → text is string[] (one entry per page).
  const pageTexts = Array.isArray(text) ? text : [text];
  return { pageCount: totalPages, pageTexts };
}
