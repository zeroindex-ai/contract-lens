import { describe, it, expect } from 'vitest';
import type { VerifiedDocumentExtraction } from '@/lib/verify';
import { buildSheet } from './export';

// downloadXlsx/downloadPdf touch the DOM + dynamically import their libs, so
// they're exercised in the browser (manual + e2e). buildSheet is the pure row
// model and worth pinning here.

function ext(): VerifiedDocumentExtraction {
  return {
    document_type: 'Commercial Invoice',
    summary: 'An invoice, with a comma and "quotes".',
    parties: [
      { name: 'Summit Office Supply Co.', role: 'Vendor', evidence_quote: 'Summit', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
    ],
    key_details: [
      { label: 'Total due', value: '$6,420.00', evidence_quote: '$6,420.00', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
      { label: 'Note', value: 'line1\nline2', evidence_quote: 'q', evidence_page: 2, confidence: 0.4, verified_page: 3, match_quality: 'wrong-page' },
    ],
  };
}

describe('buildSheet', () => {
  it('returns the preamble metadata as label/value pairs (rendered as merged cells)', () => {
    const { meta } = buildSheet(ext());
    expect(meta).toEqual([
      ['Document type', 'Commercial Invoice'],
      ['Summary', 'An invoice, with a comma and "quotes".'],
    ]);
  });

  it('has the expected table header', () => {
    expect(buildSheet(ext()).header).toEqual([
      'Section',
      'Label',
      'Value',
      'Page',
      'Verification',
      'Confidence',
      'Evidence quote',
    ]);
  });

  it('emits one data row per party and per key detail with raw (unescaped) values', () => {
    const { dataRows } = buildSheet(ext());
    expect(dataRows).toContainEqual(['Party', 'Vendor', 'Summit Office Supply Co.', 1, 'verified', '1.00', 'Summit']);
    // commas/quotes/newlines stay raw — the spreadsheet layer handles them.
    expect(dataRows).toContainEqual(['Detail', 'Total due', '$6,420.00', 1, 'verified', '1.00', '$6,420.00']);
  });

  it('cites the verified page (not the claimed page) and labels the band', () => {
    const { dataRows } = buildSheet(ext());
    // wrong-page detail: claimed p.2, verified p.3, confidence 0.40 (< 0.5) → red → "not verified"
    expect(dataRows).toContainEqual(['Detail', 'Note', 'line1\nline2', 3, 'not verified', '0.40', 'q']);
  });
});
