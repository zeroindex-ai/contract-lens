import { createHash } from 'node:crypto';

/**
 * Cheap pre-API validation for visitor uploads. All guards run before any
 * Anthropic call so we never pay for a request that was going to fail anyway.
 *
 * Order in the route handler:
 *   1. MIME check  (request multipart)
 *   2. Size check  (Content-Length / blob.size)
 *   3. Magic bytes (read first 5 bytes — catches "renamed .pdf" files)
 *   4. Page count  (pdfjs-dist getDocument — also catches malformed PDFs)
 */

export const MAX_BYTES = 15 * 1024 * 1024; // 15 MB
export const MAX_PAGES = 50;

export type GuardCode =
  | 'WRONG_MIME'
  | 'FILE_TOO_LARGE'
  | 'NOT_A_PDF'
  | 'TOO_MANY_PAGES'
  | 'EMPTY_FILE'
  | 'SCANNED_PDF_NOT_SUPPORTED';

export class GuardError extends Error {
  constructor(
    public readonly code: GuardCode,
    message: string
  ) {
    super(message);
    this.name = 'GuardError';
  }
}

export function assertMime(mime: string | null | undefined): void {
  if (mime !== 'application/pdf') {
    throw new GuardError('WRONG_MIME', `Expected application/pdf, got ${mime ?? 'no MIME'}`);
  }
}

export function assertSize(byteLength: number): void {
  if (byteLength === 0) {
    throw new GuardError('EMPTY_FILE', 'PDF is empty');
  }
  if (byteLength > MAX_BYTES) {
    throw new GuardError(
      'FILE_TOO_LARGE',
      `PDF is ${(byteLength / 1024 / 1024).toFixed(1)} MB; max is ${MAX_BYTES / 1024 / 1024} MB`
    );
  }
}

export function assertMagicBytes(buffer: Uint8Array): void {
  // PDFs always begin with "%PDF-" (0x25 0x50 0x44 0x46 0x2D).
  if (
    buffer.length < 5 ||
    buffer[0] !== 0x25 ||
    buffer[1] !== 0x50 ||
    buffer[2] !== 0x44 ||
    buffer[3] !== 0x46 ||
    buffer[4] !== 0x2d
  ) {
    throw new GuardError('NOT_A_PDF', 'File does not start with %PDF- header');
  }
}

export function assertPageCount(pageCount: number): void {
  if (pageCount > MAX_PAGES) {
    throw new GuardError(
      'TOO_MANY_PAGES',
      `PDF has ${pageCount} pages; max is ${MAX_PAGES}`
    );
  }
}

/**
 * Detect PDFs that are pure scans (no extractable text). The verification
 * layer can't operate on these so we fail fast with a clear message.
 *
 * Heuristic: if total extracted text across all pages is < 100 chars per page
 * on average, we assume it's a scan. Real documents always have lots of text.
 */
export function assertHasExtractableText(pageTexts: string[]): void {
  if (pageTexts.length === 0) {
    throw new GuardError('SCANNED_PDF_NOT_SUPPORTED', 'PDF contains no extractable text');
  }
  const total = pageTexts.reduce((sum, p) => sum + p.length, 0);
  const avg = total / pageTexts.length;
  if (avg < 100) {
    throw new GuardError(
      'SCANNED_PDF_NOT_SUPPORTED',
      'PDF appears to be a scan with no extractable text; only PDFs with embedded text are supported'
    );
  }
}

/**
 * SHA-256 hex digest. Used as the dedup key in the extractions table — if the
 * same PDF is uploaded twice, both rows reference the same hash but the JSON
 * may differ (Claude is non-deterministic).
 */
export function sha256(buffer: Uint8Array): string {
  return createHash('sha256').update(buffer).digest('hex');
}
