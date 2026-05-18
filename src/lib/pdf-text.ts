/**
 * Extract per-page text from a PDF buffer using pdfjs-dist (Node-side).
 *
 * Two outputs:
 *   - `pageTexts[i]` — flattened text for page (i+1), used by the verification
 *     layer to match against the model's evidence_quote
 *   - `pageCount` — used by the upload guard to enforce the ≤30 page cap
 *     before paying for an Anthropic call
 *
 * The Node-friendly entrypoint is the `legacy` build; the default ESM build
 * assumes a browser-y environment. Worker is disabled because we're running
 * inline in a serverless function.
 */

// pdfjs-dist 4.x — legacy build is the Node-compatible entrypoint
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let pdfjsModulePromise: Promise<any> | null = null;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getPdfjs(): Promise<any> {
  if (!pdfjsModulePromise) {
    pdfjsModulePromise = import('pdfjs-dist/legacy/build/pdf.mjs');
  }
  return pdfjsModulePromise;
}

export interface PdfTextResult {
  pageCount: number;
  pageTexts: string[];
}

/**
 * Extract per-page text from a PDF.
 *
 * Throws if the buffer is not a valid PDF (pdfjs surfaces this as an
 * InvalidPDFException). Callers should treat the error as a 4xx
 * NOT_A_PDF response to the visitor.
 */
export async function extractPdfText(pdfBuffer: Uint8Array): Promise<PdfTextResult> {
  const pdfjs = await getPdfjs();

  const loadingTask = pdfjs.getDocument({
    data: pdfBuffer,
    // Node.js: no worker, no canvas-based rendering.
    disableWorker: true,
    isEvalSupported: false,
    useSystemFonts: false,
  });

  const doc = await loadingTask.promise;
  const pageCount: number = doc.numPages;

  const pageTexts: string[] = [];
  for (let pageNum = 1; pageNum <= pageCount; pageNum++) {
    const page = await doc.getPage(pageNum);
    const content = await page.getTextContent();
    // content.items: Array<{ str: string, hasEOL?: boolean }>
    // Glue items with spaces; honor end-of-line breaks. The verification layer
    // normalizes whitespace anyway, so we don't need to be precise here.
    const text = content.items
      .map((item: { str?: string; hasEOL?: boolean }) => {
        const s = item.str ?? '';
        return item.hasEOL ? `${s}\n` : s;
      })
      .join(' ');
    pageTexts.push(text);
    // Free per-page memory; PDFs of 30 pages aren't huge but be tidy.
    page.cleanup();
  }

  // Release the document handle.
  await doc.destroy();

  return { pageCount, pageTexts };
}

/**
 * Cheap page-count probe used by the upload guard. Faster than full text
 * extraction because it only reads the catalog, but in practice the cost
 * difference is small enough for 30-page caps that we just delegate to
 * `extractPdfText` and discard the texts.
 *
 * Kept as a named export so callers can express intent clearly.
 */
export async function pdfPageCount(pdfBuffer: Uint8Array): Promise<number> {
  const { pageCount } = await extractPdfText(pdfBuffer);
  return pageCount;
}
