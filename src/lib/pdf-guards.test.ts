import { describe, expect, it } from 'vitest';
import {
  assertHasExtractableText,
  assertMagicBytes,
  assertMime,
  assertPageCount,
  assertSize,
  GuardError,
  type GuardCode,
  MAX_BYTES,
  MAX_PAGES,
  sha256,
} from './pdf-guards';

const PDF_MAGIC = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37]); // %PDF-1.7

/**
 * Run `fn` and assert it threw a GuardError with the expected code.
 * Vitest's `.toMatchObject` doesn't unwrap thrown errors; capture-and-assert is.
 */
function expectGuardError(fn: () => void, code: GuardCode): void {
  let caught: unknown;
  try {
    fn();
  } catch (e) {
    caught = e;
  }
  expect(caught).toBeInstanceOf(GuardError);
  expect((caught as GuardError).code).toBe(code);
}

describe('assertMime', () => {
  it('passes for application/pdf', () => {
    expect(() => assertMime('application/pdf')).not.toThrow();
  });

  it('throws WRONG_MIME for other types', () => {
    expectGuardError(() => assertMime('text/plain'), 'WRONG_MIME');
  });

  it('throws WRONG_MIME for null/undefined', () => {
    expectGuardError(() => assertMime(null), 'WRONG_MIME');
    expectGuardError(() => assertMime(undefined), 'WRONG_MIME');
  });
});

describe('assertSize', () => {
  it('passes for sizes within limit', () => {
    expect(() => assertSize(1024)).not.toThrow();
    expect(() => assertSize(MAX_BYTES)).not.toThrow();
  });

  it('throws EMPTY_FILE for 0 bytes', () => {
    expectGuardError(() => assertSize(0), 'EMPTY_FILE');
  });

  it('throws FILE_TOO_LARGE above the cap', () => {
    expectGuardError(() => assertSize(MAX_BYTES + 1), 'FILE_TOO_LARGE');
  });
});

describe('assertMagicBytes', () => {
  it('passes for a buffer starting with %PDF-', () => {
    expect(() => assertMagicBytes(PDF_MAGIC)).not.toThrow();
  });

  it('throws NOT_A_PDF for non-PDF bytes', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d]);
    expectGuardError(() => assertMagicBytes(png), 'NOT_A_PDF');
  });

  it('throws NOT_A_PDF for a buffer too short to inspect', () => {
    expectGuardError(() => assertMagicBytes(new Uint8Array([0x25, 0x50])), 'NOT_A_PDF');
  });
});

describe('assertPageCount', () => {
  it('passes at and below the cap', () => {
    expect(() => assertPageCount(1)).not.toThrow();
    expect(() => assertPageCount(MAX_PAGES)).not.toThrow();
  });

  it('throws TOO_MANY_PAGES above the cap', () => {
    expectGuardError(() => assertPageCount(MAX_PAGES + 1), 'TOO_MANY_PAGES');
  });
});

describe('assertHasExtractableText', () => {
  it('passes for normal-length page texts', () => {
    expect(() => assertHasExtractableText(['x'.repeat(500), 'y'.repeat(500)])).not.toThrow();
  });

  it('throws for empty page list', () => {
    expectGuardError(() => assertHasExtractableText([]), 'SCANNED_PDF_NOT_SUPPORTED');
  });

  it('throws SCANNED_PDF_NOT_SUPPORTED for low text density', () => {
    expectGuardError(() => assertHasExtractableText(['hi', 'lo', '']), 'SCANNED_PDF_NOT_SUPPORTED');
  });
});

describe('sha256', () => {
  it('produces a 64-char hex digest', () => {
    const out = sha256(new Uint8Array([1, 2, 3]));
    expect(out).toMatch(/^[0-9a-f]{64}$/);
  });

  it('is deterministic', () => {
    expect(sha256(PDF_MAGIC)).toBe(sha256(PDF_MAGIC));
  });

  it('changes when input changes', () => {
    expect(sha256(new Uint8Array([1]))).not.toBe(sha256(new Uint8Array([2])));
  });
});
