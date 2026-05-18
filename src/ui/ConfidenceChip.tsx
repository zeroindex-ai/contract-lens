import type { MatchQuality } from '@/lib/verify';
import { bandFor, bandLabel } from './confidence';

export interface ConfidenceChipProps {
  confidence: number;
  matchQuality: MatchQuality;
}

/**
 * Small colored pill showing the per-field confidence and band.
 * Hover surfaces the band label + the underlying match_quality so the
 * mechanism stays visible without crowding the resting state.
 */
export function ConfidenceChip({ confidence, matchQuality }: ConfidenceChipProps) {
  const band = bandFor(matchQuality, confidence);
  const className = `chip chip-${band}`;
  const label = matchQuality === 'null-field' ? '—' : confidence.toFixed(2);
  const title = `${bandLabel(band)} · ${matchQuality}`;

  return (
    <span className={className} title={title} aria-label={title}>
      <span className="chip-dot" aria-hidden="true"></span>
      {label}
    </span>
  );
}
