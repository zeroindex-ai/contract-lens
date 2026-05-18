import type { MatchQuality } from '@/lib/verify';

/**
 * Confidence-band coloring used by ConfidenceChip and the warning banner.
 *
 * Decision: color by the numeric confidence, NOT by match_quality. Reason:
 * a `fuzzy` match at 0.95 is essentially correct and should look green,
 * not amber — match_quality describes the mechanism, confidence describes
 * the strength. Match quality is still surfaced in the hover tooltip and
 * the field meta line so the rigor signal isn't lost.
 *
 * Special case: `null-field` is gray regardless of confidence (the model
 * said "not in this contract"; we can't verify a negative).
 */

export type ConfidenceBand = 'green' | 'amber' | 'red' | 'gray';

export const CONFIDENCE_THRESHOLDS = {
  green: 0.9,
  amber: 0.5,
  // below 0.5 → red
} as const;

/** Threshold below which a field counts as "couldn't be verified" — drives the banner. */
export const REVIEW_THRESHOLD = 0.5;

export function bandFor(matchQuality: MatchQuality, confidence: number): ConfidenceBand {
  if (matchQuality === 'null-field') return 'gray';
  if (confidence >= CONFIDENCE_THRESHOLDS.green) return 'green';
  if (confidence >= CONFIDENCE_THRESHOLDS.amber) return 'amber';
  return 'red';
}

/** Short human label for the band, used in the chip's hover tooltip. */
export function bandLabel(band: ConfidenceBand): string {
  switch (band) {
    case 'green':
      return 'verified';
    case 'amber':
      return 'low confidence';
    case 'red':
      return 'not verified';
    case 'gray':
      return 'not in contract';
  }
}
