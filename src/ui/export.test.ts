import { describe, it, expect } from 'vitest';
import ExcelJS from 'exceljs';
import type { VerifiedDocumentExtraction } from '@/lib/verify';
import { buildSheet, buildWorkbook } from './export';

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

describe('buildWorkbook — spreadsheet-injection safety', () => {
  function findCell(ws: ExcelJS.Worksheet, value: string): ExcelJS.Cell | undefined {
    let found: ExcelJS.Cell | undefined;
    ws.eachRow((row) =>
      row.eachCell((cell) => {
        if (cell.value === value) found = cell;
      })
    );
    return found;
  }

  // A formula-looking value from an untrusted document must NOT become a live
  // formula. exceljs writes cell.value strings as String-typed cells, so this
  // is inherent — but pin it so a future refactor can't silently regress it.
  it('writes a formula-looking value as an inert String cell, not a formula', async () => {
    const evil = '=HYPERLINK("http://evil","click")';
    const extraction: VerifiedDocumentExtraction = {
      document_type: 'Invoice',
      summary: 'x',
      parties: [],
      key_details: [
        { label: 'Note', value: evil, evidence_quote: evil, evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
      ],
    };
    const ws = (await buildWorkbook(extraction)).getWorksheet('Extraction')!;
    const cell = findCell(ws, evil);
    expect(cell).toBeDefined();
    expect(cell!.type).toBe(ExcelJS.ValueType.String);
    expect(cell!.type).not.toBe(ExcelJS.ValueType.Formula);
    expect(cell!.formula).toBeUndefined();
  });

  // The flip side: don't mangle legitimate values that start with - / + / @
  // (negative amounts, dates) — they must survive verbatim, no defensive prefix.
  it('preserves leading -/+/@ values verbatim (no prefixing)', async () => {
    const neg = '-$1,000.00';
    const extraction: VerifiedDocumentExtraction = {
      document_type: 'Invoice',
      summary: 'x',
      parties: [],
      key_details: [
        { label: 'Credit', value: neg, evidence_quote: neg, evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
      ],
    };
    const ws = (await buildWorkbook(extraction)).getWorksheet('Extraction')!;
    expect(findCell(ws, neg)).toBeDefined();
  });
});
