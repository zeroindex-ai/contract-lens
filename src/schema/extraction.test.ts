import { describe, expect, it } from 'vitest';
import { DocumentExtractionSchema } from './extraction';

const fullExtraction = {
  document_type: 'Sales Agreement',
  summary: 'A sales agreement between Acme Corp and Beta LLC.',
  parties: [
    { name: 'Acme Corp', role: 'Seller', evidence_quote: 'between Acme Corp ("Seller")', evidence_page: 1 },
    { name: 'Beta LLC', role: 'Buyer', evidence_quote: 'and Beta LLC ("Buyer")', evidence_page: 1 },
  ],
  key_details: [
    { label: 'Effective date', value: '2026-05-17', evidence_quote: 'Effective Date: May 17, 2026', evidence_page: 1 },
    { label: 'Term', value: '3 years', evidence_quote: 'term of three (3) years', evidence_page: 2 },
    { label: 'Governing law', value: 'Pennsylvania', evidence_quote: 'laws of Pennsylvania', evidence_page: 6 },
  ],
};

describe('DocumentExtractionSchema', () => {
  it('validates a fully-populated extraction', () => {
    expect(DocumentExtractionSchema.safeParse(fullExtraction).success).toBe(true);
  });

  it('accepts empty parties + key_details arrays', () => {
    expect(
      DocumentExtractionSchema.safeParse({ ...fullExtraction, parties: [], key_details: [] }).success
    ).toBe(true);
  });

  it('requires document_type and summary', () => {
    const { document_type: _omit, ...rest } = fullExtraction;
    void _omit;
    expect(DocumentExtractionSchema.safeParse(rest).success).toBe(false);
  });

  it('rejects a key detail missing required fields', () => {
    const data = { ...fullExtraction, key_details: [{ label: 'Term', value: '3 years' }] };
    expect(DocumentExtractionSchema.safeParse(data).success).toBe(false);
  });

  it('rejects wrong type (string where page number expected)', () => {
    const data = {
      ...fullExtraction,
      key_details: [{ label: 'X', value: 'y', evidence_quote: 'y', evidence_page: 'one' }],
    };
    expect(DocumentExtractionSchema.safeParse(data).success).toBe(false);
  });

  it('accepts a non-positive page number (the model occasionally emits 0; verify tolerates it)', () => {
    const data = {
      ...fullExtraction,
      key_details: [{ label: 'X', value: 'y', evidence_quote: 'y', evidence_page: 0 }],
    };
    expect(DocumentExtractionSchema.safeParse(data).success).toBe(true);
  });

  it('rejects a non-integer page number', () => {
    const data = {
      ...fullExtraction,
      key_details: [{ label: 'X', value: 'y', evidence_quote: 'y', evidence_page: 1.5 }],
    };
    expect(DocumentExtractionSchema.safeParse(data).success).toBe(false);
  });

  it('rejects a party missing required fields', () => {
    const data = { ...fullExtraction, parties: [{ name: 'Acme Corp', role: 'Seller' }] };
    expect(DocumentExtractionSchema.safeParse(data).success).toBe(false);
  });
});
