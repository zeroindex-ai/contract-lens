import { describe, expect, it } from 'vitest';
import { buildSpanRanges, dense, matchQuote } from './highlight';

/**
 * Regression fixtures pinning the PDF citation-highlight placement. These guard
 * the dense-normalization + first-occurrence matching that <PdfPreview> uses to
 * decide which text-layer spans light up. If future edits drift the offset math
 * or the normalization, these break before the highlights silently land on the
 * wrong glyphs in the browser.
 *
 * The fixture mimics how pdfjs hands us a page: a list of span strings split at
 * arbitrary (often mid-phrase) points, with whitespace-only spans interspersed.
 */

// A page split the way pdfjs tends to: mid-word breaks + blank separator spans.
const PAGE_SPANS = [
  'This Agree', // 0
  'ment is between ', // 1
  'Acme', // 2
  ' ', // 3  (blank separator)
  'Corp', // 4
  ' and the ', // 5
  'Provider', // 6
  ', for a term of ', // 7
  'three years', // 8
  '.', // 9
];

describe('dense', () => {
  it('lowercases, folds quotes/dashes, and strips ALL whitespace', () => {
    expect(dense('Three  Years')).toBe('threeyears');
    expect(dense('“Acme” — Corp')).toBe('"acme"-corp');
  });
});

describe('buildSpanRanges', () => {
  it('concatenates dense spans into one offset space and drops blanks', () => {
    const { joined, ranges } = buildSpanRanges(PAGE_SPANS);
    expect(joined).toBe('thisagreementisbetweenacmecorpandtheprovider,foratermofthreeyears.');
    // blank span (index 3) contributes nothing and is absent from ranges
    expect(ranges.some((r) => r.index === 3)).toBe(false);
    // contiguous coverage: each range starts where the previous ended
    for (let i = 1; i < ranges.length; i++) {
      expect(ranges[i]?.start).toBe(ranges[i - 1]?.end);
    }
  });
});

describe('matchQuote', () => {
  const { joined, ranges } = buildSpanRanges(PAGE_SPANS);

  it('locates a quote that spans a blank separator across multiple spans', () => {
    // "Acme Corp" is split as ['Acme', ' ', 'Corp'] — the blank is dropped, so
    // it lands on the two text spans 2 and 4.
    const m = matchQuote('Acme Corp', joined, ranges);
    expect(m.offset).toBe(joined.indexOf('acmecorp'));
    expect(m.length).toBe('acmecorp'.length);
    expect(m.spanIndices).toEqual([2, 4]);
  });

  it('locates a quote split mid-word across span boundaries', () => {
    // "This Agreement" is split as ['This Agree', 'ment ...'] → spans 0 and 1.
    expect(matchQuote('This Agreement', joined, ranges).spanIndices).toEqual([0, 1]);
  });

  it('matches whitespace/case-insensitively (dense normalization)', () => {
    expect(matchQuote('THREE   years', joined, ranges).spanIndices).toEqual([8]);
  });

  it('returns the FIRST occurrence when a quote appears more than once', () => {
    const spans = ['foo bar', ' baz ', 'foo bar', ' end'];
    const built = buildSpanRanges(spans);
    const m = matchQuote('foo bar', built.joined, built.ranges);
    expect(m.offset).toBe(0); // first, not the second occurrence at index 2
    expect(m.spanIndices).toEqual([0]);
  });

  it('reports no spans for a quote that is absent', () => {
    const m = matchQuote('nonexistent clause', joined, ranges);
    expect(m.offset).toBe(-1);
    expect(m.spanIndices).toEqual([]);
  });

  it('reports no spans for an empty quote', () => {
    expect(matchQuote('', joined, ranges)).toEqual({ offset: -1, length: 0, spanIndices: [] });
  });
});
