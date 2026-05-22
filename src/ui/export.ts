/**
 * Client-side export of a verified extraction into two "lookup" artifacts:
 *
 *   - Excel (.xlsx) — a styled table for spreadsheets (one row per party / key
 *            detail), with a merged document-type + summary preamble.
 *   - PDF  — a compact one/two-page reference sheet a person can keep alongside
 *            the source document. Every value carries its source page + a
 *            verification mark, so the lookup sheet inherits the tool's core
 *            promise (nothing uncited, nothing unverified).
 *
 * Both run entirely in the browser — no server round-trip, so they work for
 * samples and uploads alike. jsPDF is dynamically imported inside downloadPdf
 * so it never lands in the initial bundle (only loaded on the first PDF click).
 */

import type { VerifiedDocumentExtraction, Verified } from '@/lib/verify';
import { bandFor, bandLabel, REVIEW_THRESHOLD } from './confidence';

/** Page to cite: where the quote was actually found, falling back to the claimed page. */
function citedPage(item: Verified & { evidence_page: number }): number {
  return item.verified_page ?? item.evidence_page;
}

/** Human verification status for a row, derived from the same band the UI uses. */
function statusLabel(item: Verified): string {
  return bandLabel(bandFor(item.confidence));
}

/** kebab-case the document type into a safe-ish filename stem. */
function fileStem(documentType: string): string {
  const base = documentType
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (base || 'document').slice(0, 60);
}

function triggerDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

/* -------------------------------------------------------------------------- */
/* XLSX (styled spreadsheet)                                                  */
/* -------------------------------------------------------------------------- */

// Bounded column widths (Excel "characters" units) — the max width per column.
// Long text wraps within these rather than stretching a column indefinitely.
const COLUMN_WIDTHS = [12, 24, 44, 7, 16, 12, 56] as const;

const TABLE_HEADER = ['Section', 'Label', 'Value', 'Page', 'Verification', 'Confidence', 'Evidence quote'];

// The preamble value spans C:E; merged cells don't auto-fit row height in Excel,
// so we estimate wrapped lines and set the height explicitly.
const VALUE_MERGE_WIDTH = COLUMN_WIDTHS[2] + COLUMN_WIDTHS[3] + COLUMN_WIDTHS[4];
const LINE_HEIGHT_PT = 15;

/** Rough wrapped-line count for a value in a column `widthChars` wide. */
function estimateLines(text: string, widthChars: number): number {
  return text
    .split('\n')
    .reduce((sum, segment) => sum + Math.max(1, Math.ceil(segment.length / widthChars)), 0);
}

export interface SheetData {
  /** Preamble label/value pairs, rendered as merged cells above the table. */
  meta: [string, string][];
  header: string[];
  dataRows: (string | number)[][];
}

/** Pure row model for the spreadsheet — preamble metadata, header, and table. */
export function buildSheet(extraction: VerifiedDocumentExtraction): SheetData {
  const meta: [string, string][] = [
    ['Document type', extraction.document_type],
    ['Summary', extraction.summary],
  ];
  const dataRows: (string | number)[][] = [];
  for (const p of extraction.parties) {
    dataRows.push(['Party', p.role, p.name, citedPage(p), statusLabel(p), p.confidence.toFixed(2), p.evidence_quote]);
  }
  for (const d of extraction.key_details) {
    dataRows.push(['Detail', d.label, d.value, citedPage(d), statusLabel(d), d.confidence.toFixed(2), d.evidence_quote]);
  }
  return { meta, header: TABLE_HEADER, dataRows };
}

/**
 * Build the styled workbook. Every cell value is assigned via `cell.value =`,
 * which exceljs writes as a STRING cell — never a formula. So a model/document
 * value like `=HYPERLINK(...)` is stored as inert text, not a live formula (no
 * spreadsheet-formula-injection vector), and legitimate values that start with
 * `-`/`+`/`@` (e.g. "-$1,000", "-30 days") are preserved verbatim rather than
 * mangled by a defensive prefix. Pinned by export.test.ts.
 */
export async function buildWorkbook(
  extraction: VerifiedDocumentExtraction
): Promise<import('exceljs').Workbook> {
  const mod = await import('exceljs');
  const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;

  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Extraction');
  ws.columns = COLUMN_WIDTHS.map((width) => ({ width }));

  const wrapTL = { vertical: 'top', horizontal: 'left', wrapText: true } as const;
  const { meta, header, dataRows } = buildSheet(extraction);

  // Preamble: label merged across A:B, value merged across C:E, one row each.
  let r = 1;
  for (const [label, value] of meta) {
    ws.mergeCells(r, 1, r, 2);
    ws.mergeCells(r, 3, r, 5);
    const labelCell = ws.getCell(r, 1);
    labelCell.value = label;
    labelCell.font = { bold: true };
    labelCell.alignment = wrapTL;
    const valueCell = ws.getCell(r, 3);
    valueCell.value = value;
    valueCell.alignment = wrapTL;
    // Merged cells don't auto-fit, so size the row to the wrapped value.
    ws.getRow(r).height = estimateLines(value, VALUE_MERGE_WIDTH) * LINE_HEIGHT_PT;
    r++;
  }
  r++; // blank spacer row between the preamble and the table

  // Header row (bold), then the data rows.
  for (const [i, cells] of [header, ...dataRows].entries()) {
    const row = ws.getRow(r);
    cells.forEach((v, c) => {
      const cell = row.getCell(c + 1);
      cell.value = v;
      cell.alignment = wrapTL;
      if (i === 0) cell.font = { bold: true };
    });
    r++;
  }

  return wb;
}

export async function downloadXlsx(extraction: VerifiedDocumentExtraction): Promise<void> {
  const wb = await buildWorkbook(extraction);
  const buf = await wb.xlsx.writeBuffer();
  const blob = new Blob([buf], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  triggerDownload(blob, `${fileStem(extraction.document_type)}-lookup.xlsx`);
}

/* -------------------------------------------------------------------------- */
/* PDF                                                                        */
/* -------------------------------------------------------------------------- */

// RGB triples matching the UI confidence bands (--accent-go / --warn / --error).
const BAND_RGB: Record<'green' | 'amber' | 'red', [number, number, number]> = {
  green: [22, 163, 74],
  amber: [180, 83, 9],
  red: [190, 18, 60],
};
const INK: [number, number, number] = [24, 24, 27];
const MUTED: [number, number, number] = [82, 82, 91];
const LINE: [number, number, number] = [207, 201, 189];

export async function downloadPdf(extraction: VerifiedDocumentExtraction): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'pt', format: 'letter' });

  const pageW = doc.internal.pageSize.getWidth();
  const pageH = doc.internal.pageSize.getHeight();
  const margin = 48;
  const contentW = pageW - margin * 2;
  let y = margin;

  // Advance to a new page if the next block of `needed` pt won't fit.
  function ensure(needed: number): void {
    if (y + needed > pageH - margin) {
      doc.addPage();
      y = margin;
    }
  }

  function text(
    str: string,
    opts: { size: number; bold?: boolean; color?: [number, number, number]; gap?: number } = { size: 10 }
  ): void {
    doc.setFont('helvetica', opts.bold ? 'bold' : 'normal');
    doc.setFontSize(opts.size);
    doc.setTextColor(...(opts.color ?? INK));
    const lines = doc.splitTextToSize(str, contentW) as string[];
    const lineH = opts.size * 1.32;
    ensure(lines.length * lineH);
    doc.text(lines, margin, y);
    y += lines.length * lineH + (opts.gap ?? 0);
  }

  function rule(): void {
    ensure(10);
    doc.setDrawColor(...LINE);
    doc.setLineWidth(0.5);
    doc.line(margin, y, pageW - margin, y);
    y += 12;
  }

  const verified = [...extraction.parties, ...extraction.key_details].filter(
    (i) => i.confidence >= REVIEW_THRESHOLD
  ).length;
  const total = extraction.parties.length + extraction.key_details.length;
  const flagged = total - verified;

  // ── Header ──
  text(extraction.document_type, { size: 18, bold: true, gap: 4 });
  text(
    `${total} item${total === 1 ? '' : 's'} · ${verified} verified${flagged ? ` · ${flagged} flagged for review` : ''}`,
    { size: 9, color: MUTED, gap: 10 }
  );
  if (extraction.summary) text(extraction.summary, { size: 10, color: MUTED, gap: 14 });
  rule();

  // ── Parties ──
  if (extraction.parties.length) {
    text('Parties', { size: 12, bold: true, gap: 6 });
    for (const p of extraction.parties) {
      text(p.role.toUpperCase(), { size: 8, color: MUTED, gap: 1 });
      text(p.name, { size: 11, gap: 2 });
      const band = bandFor(p.confidence);
      text(`p. ${citedPage(p)} · ${statusLabel(p)}`, { size: 8, color: BAND_RGB[band], gap: 10 });
    }
    y += 4;
  }

  // ── Key details ──
  if (extraction.key_details.length) {
    text('Key details', { size: 12, bold: true, gap: 6 });
    for (const d of extraction.key_details) {
      text(d.label.toUpperCase(), { size: 8, color: MUTED, gap: 1 });
      text(d.value, { size: 11, gap: 2 });
      const band = bandFor(d.confidence);
      text(`p. ${citedPage(d)} · ${statusLabel(d)}`, { size: 8, color: BAND_RGB[band], gap: 10 });
    }
  }

  // ── Footer on every page ──
  const pageCount = doc.getNumberOfPages();
  for (let i = 1; i <= pageCount; i++) {
    doc.setPage(i);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(8);
    doc.setTextColor(...MUTED);
    doc.text(
      'Generated by contract-lens · every value is cited to its source page · zeroindex.ai',
      margin,
      pageH - 24
    );
    doc.text(`${i} / ${pageCount}`, pageW - margin, pageH - 24, { align: 'right' });
  }

  doc.save(`${fileStem(extraction.document_type)}-lookup.pdf`);
}
