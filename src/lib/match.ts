/**
 * Text-matching primitives used by the verification layer.
 *
 * Goal: deterministically check whether the model's `evidence_quote` for a
 * field actually appears in the PDF's extracted page text. Match strength
 * drives the per-field confidence score the UI shows.
 *
 * Three tiers, applied in order:
 *   1. exactMatch       — verbatim substring
 *   2. normalizedMatch  — whitespace + smart-quotes + dashes normalized
 *   3. fuzzyMatch       — sliding-window Sørensen–Dice over character bigrams
 */

export type MatchStrength = 'exact' | 'normalized' | 'fuzzy' | 'none';

export interface MatchResult {
  strength: MatchStrength;
  /** Dice score for fuzzy matches; 1 for exact/normalized; 0 for none. */
  score: number;
  /** The actual text from the haystack that matched (post-normalization for normalized matches). */
  snippet: string | null;
}

/* -------------------------------------------------------------------------- */
/* Normalization                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Normalize a string for tolerant matching:
 *   - lowercase
 *   - collapse runs of whitespace to single spaces
 *   - convert curly quotes to straight, en/em dashes to hyphens
 *   - trim
 *
 * The PDF text-extraction layer (pdfjs-dist) frequently introduces extra
 * whitespace at line breaks and preserves whatever typographic punctuation
 * the PDF used. The model's quote often won't match those exactly even when
 * it's quoting the same span.
 */
export function normalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’‚‛′]/g, "'") // curly singles + prime → straight
    .replace(/[“”„‟″]/g, '"') // curly doubles + double prime → straight
    .replace(/[–—−]/g, '-') // en dash, em dash, minus → hyphen
    .replace(/ /g, ' ') // non-breaking space → space
    .replace(/\s+/g, ' ')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Tier 1 — exact substring                                                   */
/* -------------------------------------------------------------------------- */

export function exactMatch(needle: string, haystack: string): boolean {
  if (!needle) return false;
  return haystack.includes(needle);
}

/* -------------------------------------------------------------------------- */
/* Tier 2 — normalized substring                                              */
/* -------------------------------------------------------------------------- */

export function normalizedMatch(needle: string, haystack: string): boolean {
  const n = normalize(needle);
  if (!n) return false;
  return normalize(haystack).includes(n);
}

/* -------------------------------------------------------------------------- */
/* Tier 3 — sliding-window Sørensen–Dice                                     */
/* -------------------------------------------------------------------------- */

/** Character bigrams. "hello" → ["he", "el", "ll", "lo"]. */
export function bigrams(s: string): string[] {
  if (s.length < 2) return [];
  const out: string[] = [];
  for (let i = 0; i < s.length - 1; i++) out.push(s.slice(i, i + 2));
  return out;
}

/**
 * Sørensen–Dice coefficient over character bigrams. 0–1.
 * Symmetric, position-insensitive, tolerant of small edits and word reordering.
 */
export function diceCoefficient(a: string, b: string): number {
  const ba = bigrams(a);
  const bb = bigrams(b);
  if (ba.length === 0 && bb.length === 0) return 1;
  if (ba.length === 0 || bb.length === 0) return 0;

  const counts = new Map<string, number>();
  for (const g of ba) counts.set(g, (counts.get(g) ?? 0) + 1);

  let intersection = 0;
  for (const g of bb) {
    const c = counts.get(g);
    if (c && c > 0) {
      intersection++;
      counts.set(g, c - 1);
    }
  }
  return (2 * intersection) / (ba.length + bb.length);
}

/**
 * Slide a window of `needle.length` across `haystack`, computing the Dice
 * coefficient at each step. Return the best window — or `null` if no window
 * meets `threshold` (default 0.8).
 *
 * Both strings are normalized before comparison. The reported `snippet` is the
 * un-normalized substring from the original haystack at the matching offset
 * (so the UI can highlight the right characters).
 */
export function fuzzyMatch(
  needle: string,
  haystack: string,
  threshold = 0.8
): { score: number; snippet: string; offset: number } | null {
  const n = normalize(needle);
  const h = normalize(haystack);
  if (n.length < 4 || h.length < n.length) return null;

  // For long needles, step by a few chars rather than every char — keeps it
  // O(haystack / step * needle) instead of O(haystack * needle).
  const step = Math.max(1, Math.floor(n.length / 12));

  let best = { score: 0, offsetNorm: -1 };
  for (let i = 0; i <= h.length - n.length; i += step) {
    const window = h.slice(i, i + n.length);
    const score = diceCoefficient(n, window);
    if (score > best.score) best = { score, offsetNorm: i };
  }

  if (best.score < threshold || best.offsetNorm < 0) return null;

  // Project the normalized offset back to the original haystack. Cheapest
  // robust approach: find the normalized window inside the normalized
  // haystack, then walk both originals in parallel to find the same offset.
  const normWindow = h.slice(best.offsetNorm, best.offsetNorm + n.length);
  const origOffset = approximateOriginalOffset(haystack, normWindow);
  const snippetLen = Math.min(n.length + 20, haystack.length - origOffset);
  return {
    score: best.score,
    snippet: haystack.slice(origOffset, origOffset + snippetLen),
    offset: origOffset,
  };
}

/**
 * Best-effort projection of a normalized-window match back to the original
 * haystack. For UI highlighting precision this would deserve a proper diff
 * walk, but for v0.1 we just find the first few normalized chars of the
 * window in the un-normalized haystack with a linear scan.
 */
function approximateOriginalOffset(haystack: string, normWindow: string): number {
  // Try the first 12 normalized chars; if they appear once in the haystack
  // (case-insensitive), use that offset.
  const probe = normWindow.slice(0, Math.min(12, normWindow.length));
  if (!probe) return 0;
  const idx = haystack.toLowerCase().indexOf(probe);
  return idx >= 0 ? idx : 0;
}

/* -------------------------------------------------------------------------- */
/* Top-level match driver                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Apply tiers 1→3 in order and return the best result. Used by verify.ts on
 * a per-(field, page) basis.
 */
export function match(needle: string, haystack: string, fuzzyThreshold = 0.8): MatchResult {
  if (!needle) return { strength: 'none', score: 0, snippet: null };

  if (exactMatch(needle, haystack)) {
    return { strength: 'exact', score: 1, snippet: needle };
  }

  if (normalizedMatch(needle, haystack)) {
    return { strength: 'normalized', score: 1, snippet: normalize(needle) };
  }

  const fuzzy = fuzzyMatch(needle, haystack, fuzzyThreshold);
  if (fuzzy) {
    return { strength: 'fuzzy', score: fuzzy.score, snippet: fuzzy.snippet };
  }

  return { strength: 'none', score: 0, snippet: null };
}
