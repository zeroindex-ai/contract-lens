import type { VerifiedDocumentExtraction } from '@/lib/verify';
import { REVIEW_THRESHOLD } from './confidence';

/** Count cited items (parties + key details) that couldn't be verified. */
export function countUnverifiedFields(verified: VerifiedDocumentExtraction): {
  unverified: number;
  total: number;
} {
  const all = [...verified.parties, ...verified.key_details];
  const unverified = all.filter((f) => f.confidence < REVIEW_THRESHOLD).length;
  return { unverified, total: all.length };
}

export interface WarningBannerProps {
  verified: VerifiedDocumentExtraction;
}

export function WarningBanner({ verified }: WarningBannerProps) {
  const { unverified, total } = countUnverifiedFields(verified);
  if (unverified === 0) return null;

  return (
    <div className="warning-banner" role="alert">
      <span className="icon" aria-hidden="true">
        !
      </span>
      <div>
        <strong>{`${unverified} of ${total} details couldn’t be verified against the source PDF.`}</strong>{' '}
        Review the flagged rows below before relying on this extraction. Click a row to see what the model
        claimed and where the verification looked.
      </div>
    </div>
  );
}
