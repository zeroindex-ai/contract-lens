import type { VerifiedContractExtraction } from '@/lib/verify';
import { REVIEW_THRESHOLD } from './confidence';

/** Count fields that fall into the red band (couldn't be verified at all). */
export function countUnverifiedFields(verified: VerifiedContractExtraction): {
  unverified: number;
  total: number;
} {
  const allFields = [
    ...verified.parties,
    verified.effective_date,
    verified.term,
    verified.payment_terms,
    verified.deliverables,
    verified.ip_ownership,
    verified.termination_clause,
    verified.governing_law,
    verified.kill_fee,
    verified.limitation_of_liability,
  ];
  // null-field is fine (model said "not in contract"). Anything else below
  // REVIEW_THRESHOLD is a failed-verification field.
  const unverified = allFields.filter(
    (f) => f.match_quality !== 'null-field' && f.confidence < REVIEW_THRESHOLD
  ).length;
  return { unverified, total: allFields.length };
}

export interface WarningBannerProps {
  verified: VerifiedContractExtraction;
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
        <strong>{`${unverified} of ${total} fields couldn’t be verified against the source PDF.`}</strong>{' '}
        Review the flagged rows below before relying on this extraction. Click a row to see what the model
        claimed and where the verification looked.
      </div>
    </div>
  );
}
