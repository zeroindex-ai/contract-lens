import { normalize } from '@/lib/match';

/**
 * Pure citation-highlight matching, factored out of <PdfPreview> so it can be
 * unit-tested without a DOM. The component layers DOM wiring (class toggles,
 * data attributes, scroll-into-view) on top of these results.
 *
 * The model: the pdfjs text layer is a list of span strings. We dense-normalize
 * each span and concatenate them into one offset space (`joined`), recording the
 * [start, end) slice each span occupies. A quote is located by dense-normalizing
 * it and taking its FIRST occurrence in `joined`; every span whose slice overlaps
 * that occurrence's [idx, idx+len) range is part of the highlight.
 *
 * "Dense" = normalize() (lowercase, fold quotes/dashes, collapse whitespace) then
 * strip ALL whitespace. pdfjs splits text mid-phrase at arbitrary points, so any
 * retained separator would break a substring match across a span boundary.
 */

/** normalize() + strip ALL whitespace. */
export function dense(s: string): string {
  return normalize(s).replace(/\s+/g, '');
}

/** A span's slice of the joined dense string. `index` is its position in the input list. */
export interface SpanRange {
  index: number;
  start: number;
  end: number;
}

/**
 * Build the concatenated dense string and per-span ranges from text-layer span
 * strings. Empty (whitespace-only) spans are dropped — they contribute nothing
 * to the dense offset space — so an entry's `index` is its position in the
 * ORIGINAL `spanTexts` array.
 */
export function buildSpanRanges(spanTexts: string[]): { joined: string; ranges: SpanRange[] } {
  let joined = '';
  const ranges: SpanRange[] = [];
  spanTexts.forEach((raw, index) => {
    const t = dense(raw);
    if (!t) return;
    const start = joined.length;
    joined += t;
    ranges.push({ index, start, end: joined.length });
  });
  return { joined, ranges };
}

/** Where a quote landed in the dense offset space + which spans it touches. */
export interface QuoteMatch {
  /** Dense-offset start of the first occurrence, or -1 if not found. */
  offset: number;
  /** Dense length of the quote. */
  length: number;
  /** Indices (into the original span list) of every span overlapping the match. */
  spanIndices: number[];
}

/**
 * Locate a single quote against pre-built span ranges. First-occurrence match
 * on the dense strings; returns the overlapping span indices (empty when the
 * quote is absent).
 */
export function matchQuote(
  quote: string,
  joined: string,
  ranges: SpanRange[]
): QuoteMatch {
  const q = dense(quote);
  if (!q) return { offset: -1, length: 0, spanIndices: [] };
  const idx = joined.indexOf(q);
  if (idx < 0) return { offset: -1, length: q.length, spanIndices: [] };
  const qEnd = idx + q.length;
  const spanIndices = ranges.filter((r) => r.start < qEnd && r.end > idx).map((r) => r.index);
  return { offset: idx, length: q.length, spanIndices };
}
