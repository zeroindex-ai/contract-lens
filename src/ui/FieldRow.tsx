'use client';

import type { Verified, VerifiedKeyDetail, VerifiedParty } from '@/lib/verify';
import { ConfidenceChip } from './ConfidenceChip';

/* -------------------------------------------------------------------------- */
/* Citation footer (shared by detail + party rows)                            */
/* -------------------------------------------------------------------------- */

/** True for the citations that need the explanatory footer line (a mislocated
 *  or missing quote). Clean matches just show an inline "p. N" instead. */
function isFlagged(item: Verified): boolean {
  return item.match_quality === 'wrong-page' || item.match_quality === 'not-found';
}

/** The cited page, inline and compact — shown for clean matches to save a line. */
function PageRef({ item }: { item: Verified & { evidence_page: number } }) {
  return <span className="field-page">p.{item.verified_page ?? item.evidence_page}</span>;
}

/** Footer line for flagged citations only — carries the why (wrong/missing page). */
function CitationFoot({ item }: { item: Verified & { evidence_page: number } }) {
  return (
    <div className="field-foot">
      {item.match_quality === 'wrong-page' && item.verified_page !== null ? (
        <>
          <span>claimed p. {item.evidence_page}</span>
          <span className="foot-warn">&rarr; found on p. {item.verified_page}</span>
        </>
      ) : (
        <>
          <span>cited p. {item.evidence_page}</span>
          <span className="foot-error">quote not found in PDF</span>
        </>
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
  const flagged = isFlagged(detail);
  return (
    <button type="button" className={`field-row ${selected ? 'active' : ''}`} onClick={onSelect}>
      <div className="field-head">
        <span className="field-name">{detail.label}</span>
        <span className="field-head-right">
          {!flagged && <PageRef item={detail} />}
          <ConfidenceChip confidence={detail.confidence} matchQuality={detail.match_quality} />
        </span>
      </div>
      <div className="field-value">{detail.value}</div>
      {flagged && <CitationFoot item={detail} />}
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
            <span className="party-id">
              <span className="party-role">{p.role}</span>
              <span className="field-value-inline">{p.name}</span>
            </span>
            <span className="field-head-right">
              {!isFlagged(p) && <PageRef item={p} />}
              <ConfidenceChip confidence={p.confidence} matchQuality={p.match_quality} />
            </span>
          </div>
          {isFlagged(p) && <CitationFoot item={p} />}
        </button>
      ))}
    </>
  );
}
