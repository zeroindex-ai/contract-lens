/**
 * Confidence-band coloring used by ConfidenceChip and the warning banner.
 *
 * Decision: color by the numeric confidence. A `fuzzy` match at 0.95 is
 * essentially correct and should look green, not amber — match_quality
 * describes the mechanism, confidence describes the strength. Match quality is
 * still surfaced in the hover tooltip so the rigor signal isn't lost.
 */

export type ConfidenceBand = 'green' | 'amber' | 'red';

export const CONFIDENCE_THRESHOLDS = {
  green: 0.9,
  amber: 0.5,
  // below 0.5 → red
} as const;

/** Threshold below which an item counts as "couldn't be verified" — drives the banner. */
export const REVIEW_THRESHOLD = 0.5;

export function bandFor(confidence: number): ConfidenceBand {
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
  }
}
