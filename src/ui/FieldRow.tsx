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

export function FieldRow({ fieldKey, field, selected, onSelect }: FieldRowProps) {
  const isNullField = field.match_quality === 'null-field';
  const valueDisplay = isNullField ? 'Not in this contract' : field.value ?? '—';

  return (
    <button
      type="button"
      className={`field-row ${selected ? 'selected' : ''}`}
      onClick={onSelect}
      // Make the whole row work as a button without losing left-alignment.
      style={{ display: 'block', width: '100%', textAlign: 'left', background: 'none', fontFamily: 'inherit' }}
    >
      <div className="flex justify-between items-start gap-3">
        <span className="field-label">{FIELD_LABELS[fieldKey]}</span>
        <ConfidenceChip confidence={field.confidence} matchQuality={field.match_quality} />
      </div>
      <div className={`field-value ${isNullField ? 'null' : ''}`}>{valueDisplay}</div>
      {!isNullField && field.evidence_page !== null && (
        <div className="field-meta">
          <span>p. {field.evidence_page}</span>
          {field.match_quality === 'wrong-page' && field.verified_page !== null && (
            <span style={{ color: 'var(--warn)' }}>
              → found on p. {field.verified_page}
            </span>
          )}
          {field.match_quality === 'not-found' && (
            <span style={{ color: 'var(--error)' }}>quote not found in PDF</span>
          )}
          {field.match_quality === 'incomplete' && (
            <span style={{ color: 'var(--warn)' }}>incomplete extraction</span>
          )}
        </div>
      )}
    </button>
  );
}

/* -------------------------------------------------------------------------- */
/* Parties row — special case because it's an array of objects                */
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
        <div className="field-label">{FIELD_LABELS.parties}</div>
        <div className="field-value null">No parties identified</div>
      </div>
    );
  }

  return (
    <div>
      <div className="field-label" style={{ padding: '14px 18px 4px 22px' }}>
        {FIELD_LABELS.parties}
      </div>
      {parties.map((p, i) => (
        <button
          key={`${p.name}-${i}`}
          type="button"
          className={`field-row ${selectedIndex === i ? 'selected' : ''}`}
          onClick={() => onSelect(i)}
          style={{
            display: 'block',
            width: '100%',
            textAlign: 'left',
            background: 'none',
            fontFamily: 'inherit',
          }}
        >
          <div className="flex justify-between items-start gap-3">
            <div>
              <span className="party-pill">{p.role}</span>
              <span className="field-value" style={{ display: 'inline', marginTop: 0 }}>
                {p.name}
              </span>
            </div>
            <ConfidenceChip confidence={p.confidence} matchQuality={p.match_quality} />
          </div>
          <div className="field-meta">
            <span>p. {p.evidence_page}</span>
            {p.match_quality === 'wrong-page' && p.verified_page !== null && (
              <span style={{ color: 'var(--warn)' }}>→ found on p. {p.verified_page}</span>
            )}
            {p.match_quality === 'not-found' && (
              <span style={{ color: 'var(--error)' }}>quote not found in PDF</span>
            )}
          </div>
        </button>
      ))}
    </div>
  );
}
