import { describe, expect, it } from 'vitest';
import { ContractExtractionSchema, SCALAR_FIELD_KEYS, FIELD_LABELS } from './extraction';

const fullExtraction = {
  parties: [
    {
      name: 'Acme Corp',
      role: 'Seller',
      evidence_quote: 'between Acme Corp ("Seller")',
      evidence_page: 1,
    },
    {
      name: 'Beta LLC',
      role: 'Buyer',
      evidence_quote: 'and Beta LLC ("Buyer")',
      evidence_page: 1,
    },
  ],
  effective_date: {
    value: '2026-05-17',
    evidence_quote: 'Effective Date: May 17, 2026',
    evidence_page: 1,
  },
  term: { value: '3 years', evidence_quote: 'term of three (3) years', evidence_page: 2 },
  payment_terms: { value: '$50,000 on signing', evidence_quote: '$50,000 due upon execution', evidence_page: 3 },
  deliverables: { value: 'Software MVP', evidence_quote: 'deliver the MVP', evidence_page: 2 },
  ip_ownership: { value: 'work-for-hire', evidence_quote: 'work made for hire', evidence_page: 4 },
  termination_clause: { value: '30 days notice', evidence_quote: 'with 30 days written notice', evidence_page: 5 },
  governing_law: { value: 'Pennsylvania', evidence_quote: 'governed by the laws of Pennsylvania', evidence_page: 6 },
  kill_fee: null,
  limitation_of_liability: { value: 'capped at fees paid', evidence_quote: 'in no event shall liability exceed fees paid', evidence_page: 6 },
};

describe('ContractExtractionSchema', () => {
  it('validates a fully-populated extraction', () => {
    const result = ContractExtractionSchema.safeParse(fullExtraction);
    expect(result.success).toBe(true);
  });

  it('validates a null field (field not found in contract)', () => {
    const data = { ...fullExtraction, governing_law: null };
    const result = ContractExtractionSchema.safeParse(data);
    expect(result.success).toBe(true);
  });

  it('accepts empty parties array (no parties found)', () => {
    const result = ContractExtractionSchema.safeParse({ ...fullExtraction, parties: [] });
    expect(result.success).toBe(true);
  });

  it('rejects a partial field (must be full object or null, not partial)', () => {
    // Whole-field nullability: a present field needs all three properties.
    // A partial object (missing evidence_quote/page) is invalid.
    const data = {
      ...fullExtraction,
      term: { value: '3 years' },
    };
    const result = ContractExtractionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects a missing top-level field', () => {
    const { effective_date: _omit, ...rest } = fullExtraction;
    void _omit;
    const result = ContractExtractionSchema.safeParse(rest);
    expect(result.success).toBe(false);
  });

  it('rejects wrong type (string where page number expected)', () => {
    const data = {
      ...fullExtraction,
      effective_date: { value: '2026-05-17', evidence_quote: 'May 17, 2026', evidence_page: 'one' },
    };
    const result = ContractExtractionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects zero or negative page numbers', () => {
    const data = {
      ...fullExtraction,
      effective_date: { value: '2026-05-17', evidence_quote: 'May 17, 2026', evidence_page: 0 },
    };
    const result = ContractExtractionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });

  it('rejects a party missing required fields', () => {
    const data = {
      ...fullExtraction,
      parties: [{ name: 'Acme Corp', role: 'Seller', evidence_quote: 'Acme Corp' }],
    };
    const result = ContractExtractionSchema.safeParse(data);
    expect(result.success).toBe(false);
  });
});

describe('SCALAR_FIELD_KEYS + FIELD_LABELS', () => {
  it('every scalar key has a label', () => {
    for (const key of SCALAR_FIELD_KEYS) {
      expect(FIELD_LABELS[key]).toBeDefined();
    }
  });

  it('parties has a label even though it is not a scalar key', () => {
    expect(FIELD_LABELS.parties).toBe('Parties');
  });
});
