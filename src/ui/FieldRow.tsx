'use client';

import type { VerifiedField, VerifiedParty } from '@/lib/verify';
import { ConfidenceChip } from './ConfidenceChip';
import { FIELD_LABELS, type ScalarFieldKey } from '@/schema/extraction';

/* -------------------------------------------------------------------------- */
/* Scalar field row                                                           */
/* -------------------------------------------------------------------------- */

export interface FieldRowProps {
  fieldKey: ScalarFieldKey;
  field: VerifiedField;
  selected: boolean;
  onSelect: () => void;
}

function FieldFoot({ field }: { field: VerifiedField }) {
  if (field.match_quality === 'null-field') return null;
  return (
    <div className="field-foot">
      {field.match_quality === 'wrong-page' && field.verified_page !== null ? (
        <>
          <span>claimed p. {field.evidence_page}</span>
          <span className="foot-warn">&rarr; found on p. {field.verified_page}</span>
        </>
      ) : field.match_quality === 'not-found' ? (
        <>
          <span>cited p. {field.evidence_page}</span>
          <span className="foot-error">quote not found in PDF</span>
        </>
      ) : field.match_quality === 'incomplete' ? (
        <span className="foot-warn">incomplete extraction</span>
      ) : (
        <span>p. {field.evidence_page}</span>
      )}
    </div>
  );
}

export function FieldRow({ fieldKey, field, selected, onSelect }: FieldRowProps) {
  const isNullField = field.match_quality === 'null-field';
  return (
    <button type="button" className={`field-row ${selected ? 'active' : ''}`} onClick={onSelect}>
      <div className="field-head">
        <span className="field-name">{FIELD_LABELS[fieldKey]}</span>
        <ConfidenceChip confidence={field.confidence} matchQuality={field.match_quality} />
      </div>
      <div className={`field-value ${isNullField ? 'null' : ''}`}>
        {isNullField ? 'Not in this contract' : (field.value ?? '—')}
      </div>
      <FieldFoot field={field} />
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
          <div className="field-foot">
            {p.match_quality === 'wrong-page' && p.verified_page !== null ? (
              <>
                <span>claimed p. {p.evidence_page}</span>
                <span className="foot-warn">&rarr; found on p. {p.verified_page}</span>
              </>
            ) : p.match_quality === 'not-found' ? (
              <>
                <span>cited p. {p.evidence_page}</span>
                <span className="foot-error">quote not found in PDF</span>
              </>
            ) : (
              <span>p. {p.evidence_page}</span>
            )}
          </div>
        </button>
      ))}
    </>
  );
}
