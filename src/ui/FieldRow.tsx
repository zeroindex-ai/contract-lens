'use client';

import type { Verified, VerifiedKeyDetail, VerifiedParty } from '@/lib/verify';
import { ConfidenceChip } from './ConfidenceChip';

/* -------------------------------------------------------------------------- */
/* Citation footer (shared by detail + party rows)                            */
/* -------------------------------------------------------------------------- */

function CitationFoot({ item }: { item: Verified & { evidence_page: number } }) {
  return (
    <div className="field-foot">
      {item.match_quality === 'wrong-page' && item.verified_page !== null ? (
        <>
          <span>claimed p. {item.evidence_page}</span>
          <span className="foot-warn">&rarr; found on p. {item.verified_page}</span>
        </>
      ) : item.match_quality === 'not-found' ? (
        <>
          <span>cited p. {item.evidence_page}</span>
          <span className="foot-error">quote not found in PDF</span>
        </>
      ) : (
        <span>p. {item.evidence_page}</span>
      )}
    </div>
  );
}

/* -------------------------------------------------------------------------- */
/* Key-detail row                                                             */
/* -------------------------------------------------------------------------- */

export interface DetailRowProps {
  detail: VerifiedKeyDetail;
  selected: boolean;
  onSelect: () => void;
}

export function DetailRow({ detail, selected, onSelect }: DetailRowProps) {
  return (
    <button type="button" className={`field-row ${selected ? 'active' : ''}`} onClick={onSelect}>
      <div className="field-head">
        <span className="field-name">{detail.label}</span>
        <ConfidenceChip confidence={detail.confidence} matchQuality={detail.match_quality} />
      </div>
      <div className="field-value">{detail.value}</div>
      <CitationFoot item={detail} />
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Parties row — array of objects                                             */
/* -------------------------------------------------------------------------- */

export interface PartiesRowProps {
  parties: VerifiedParty[];
  selectedIndex: number | null;
  onSelect: (index: number) => void;
}

export function PartiesRow({ parties, selectedIndex, onSelect }: PartiesRowProps) {
  if (parties.length === 0) {
    return (
      <div className="field-row" style={{ cursor: 'default' }}>
        <div className="field-value null">No parties identified</div>
      </div>
    );
  }

  return (
    <>
      {parties.map((p, i) => (
        <button
          key={`${p.name}-${i}`}
          type="button"
          className={`field-row ${selectedIndex === i ? 'active' : ''}`}
          onClick={() => onSelect(i)}
        >
          <div className="field-head">
            <span>
              <span className="party-role">{p.role}</span>
              <span className="field-value-inline">{p.name}</span>
            </span>
            <ConfidenceChip confidence={p.confidence} matchQuality={p.match_quality} />
          </div>
          <CitationFoot item={p} />
        </button>
      ))}
    </>
  );
}
