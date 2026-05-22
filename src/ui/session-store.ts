import type { VerifiedDocumentExtraction } from '@/lib/verify';
import type { ExtractionMetadataShape } from './ExtractionViewer';

/**
 * Persists the currently-viewed document so a page refresh keeps the user on
 * the viewer instead of dropping them back to the upload screen (which would
 * waste another extraction call). Uses sessionStorage on purpose: it survives
 * a refresh but is cleared when the tab closes, so an uploaded document's bytes
 * don't linger on disk — consistent with the server's extract-and-discard.
 *
 * Samples store just their id (re-fetched for free). Uploads store the
 * extraction result + the PDF bytes (base64), since the server keeps no copy.
 * Large uploads may exceed the sessionStorage quota; saving fails silently in
 * that case and refresh simply behaves as before for that document.
 */

const KEY = 'contract-lens:session';

export type PersistedSession =
  | { kind: 'sample'; sampleId: string }
  | {
      kind: 'upload';
      sourceLabel: string;
      extraction: VerifiedDocumentExtraction;
      metadata?: ExtractionMetadataShape;
      pdfBase64: string;
    };

export function saveSession(session: PersistedSession): void {
  try {
    sessionStorage.setItem(KEY, JSON.stringify(session));
  } catch {
    // Quota exceeded (large upload) or storage unavailable — skip persisting.
  }
}

export function loadSession(): PersistedSession | null {
  try {
    const raw = sessionStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as PersistedSession) : null;
  } catch {
    return null;
  }
}

export function clearSession(): void {
  try {
    sessionStorage.removeItem(KEY);
  } catch {
    // ignore
  }
}

export function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export function base64ToBlob(base64: string, type = 'application/pdf'): Blob {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}
