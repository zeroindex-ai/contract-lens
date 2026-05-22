// Deterministic tests for the eval checks (no API key / network). Verifies the
// grading logic over the open document shape: document type, parties, key
// facts, the no-hallucination control, and citation verification.

import { describe, it, expect } from 'vitest';
import type { GoldenItem, PartialResult } from '@zeroindex-ai/eval-pack';
import type { VerifiedDocumentExtraction } from '@/lib/verify';
import { documentType, partiesPresent, keyFacts, mustNot, citationsVerified, type Expected } from './checks';

function item(expected: Expected): GoldenItem {
  return { id: 't', category: 'c', question: 't', metadata: { expected } };
}

function result(extraction: VerifiedDocumentExtraction): PartialResult {
  return {
    id: 't',
    category: 'c',
    question: 't',
    text: '',
    retrievedRefs: [],
    citationRefs: [],
    recall: null,
    timings: { totalMs: 0 },
    metadata: { extraction },
  };
}

const cited = (label: string, value: string, mq: 'exact' | 'wrong-page' | 'not-found' = 'exact') => ({
  label,
  value,
  evidence_quote: value,
  evidence_page: 1,
  confidence: mq === 'exact' ? 1 : mq === 'wrong-page' ? 0.4 : 0,
  verified_page: mq === 'not-found' ? null : 1,
  match_quality: mq,
});

const invoice: VerifiedDocumentExtraction = {
  document_type: 'Commercial Invoice',
  summary: 'An invoice.',
  parties: [
    { name: 'Summit Office Supply Co.', role: 'Vendor', evidence_quote: 'Summit', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
    { name: 'Lakeside Consulting LLC', role: 'Bill to', evidence_quote: 'Lakeside', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
  ],
  key_details: [cited('Total due', '$6,420.00'), cited('Payment terms', 'Net 30')],
};

describe('eval checks on a clean document', () => {
  const expected: Expected = {
    document_type: ['invoice'],
    parties: ['Summit', 'Lakeside'],
    key_facts: ['$6,420', 'net 30'],
    must_not: ['kill fee', 'governing law'],
  };
  it('passes document_type, parties, key_facts, must_not, and citations', () => {
    const r = result(invoice);
    expect(documentType(item(expected), r).ok).toBe(true);
    expect(partiesPresent(item(expected), r).ok).toBe(true);
    expect(keyFacts(item(expected), r).ok).toBe(true);
    expect(mustNot(item(expected), r).ok).toBe(true);
    expect(citationsVerified(item(expected), r).ok).toBe(true);
  });
});

describe('eval checks catch problems', () => {
  it('key_facts fails when an expected fact is missing', () => {
    const r = result(invoice);
    expect(keyFacts(item({ key_facts: ['$9,999'] }), r).ok).toBe(false);
  });

  it('must_not fails when a forbidden fact is fabricated', () => {
    const r = result({ ...invoice, key_details: [...invoice.key_details, cited('Governing law', 'Delaware')] });
    expect(mustNot(item({ must_not: ['governing law'] }), r).ok).toBe(false);
  });

  it('citations_verified fails on a not-found quote', () => {
    const r = result({ ...invoice, key_details: [cited('Bogus', 'nope', 'not-found')] });
    expect(citationsVerified(item({}), r).ok).toBe(false);
  });

  it('document_type fails on a misclassification', () => {
    const r = result(invoice);
    expect(documentType(item({ document_type: ['employment'] }), r).ok).toBe(false);
  });
});
