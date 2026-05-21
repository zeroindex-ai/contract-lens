// Deterministic tests for the eval checks, using the committed sample
// extraction JSONs as fixtures. No API key / network needed — this verifies
// the grading logic itself: clean contracts pass, and the two deliberately
// tampered demo samples (wrong-page term, hallucinated payment clause) are
// caught by citations_verified / field_values.

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';
import type { GoldenItem, PartialResult } from '@zeroindex-ai/eval-pack';
import type { VerifiedContractExtraction } from '@/lib/verify';
import { fieldValues, partiesPresent, citationsVerified } from './checks';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SAMPLES = join(ROOT, 'public', 'samples');

const golden = JSON.parse(readFileSync(join(__dirname, 'golden.json'), 'utf-8')) as {
  items: GoldenItem[];
};

function itemFor(id: string): GoldenItem {
  const item = golden.items.find((i) => i.id === id);
  if (!item) throw new Error(`no golden item ${id}`);
  return item;
}

function resultFor(id: string): PartialResult {
  const extraction = JSON.parse(
    readFileSync(join(SAMPLES, `${id}.json`), 'utf-8')
  ) as VerifiedContractExtraction;
  return {
    id,
    category: 'test',
    question: id,
    text: '',
    retrievedRefs: [],
    citationRefs: [],
    recall: null,
    timings: { totalMs: 0 },
    metadata: { extraction },
  };
}

const run = (id: string) => {
  const item = itemFor(id);
  const result = resultFor(id);
  return {
    fieldValues: fieldValues(item, result),
    parties: partiesPresent(item, result),
    citations: citationsVerified(item, result),
  };
};

describe('clean contracts pass every check', () => {
  for (const id of ['mutual-nda', 'consulting-msa']) {
    it(id, () => {
      const r = run(id);
      expect(r.fieldValues.ok, JSON.stringify(r.fieldValues.detail)).toBe(true);
      expect(r.parties.ok, JSON.stringify(r.parties.detail)).toBe(true);
      expect(r.citations.ok, JSON.stringify(r.citations.detail)).toBe(true);
    });
  }
});

describe('citations_verified catches a mis-paginated quote', () => {
  it('fixed-fee-sow term is flagged wrong-page', () => {
    const r = run('fixed-fee-sow');
    // Field values still match (the value is correct; only the cited page is wrong).
    expect(r.fieldValues.ok).toBe(true);
    expect(r.parties.ok).toBe(true);
    // The verification layer caught the bad citation.
    expect(r.citations.ok).toBe(false);
    const offenders = (r.citations.detail as { offenders: Array<{ field: string }> }).offenders;
    expect(offenders.some((o) => o.field === 'term')).toBe(true);
  });
});

describe('a hallucinated field is caught two ways', () => {
  it('contributor-license-agreement invents a payment clause', () => {
    const r = run('contributor-license-agreement');
    // Ground truth says payment_terms must be absent → field_values fails.
    expect(r.fieldValues.ok).toBe(false);
    // The fabricated quote does not appear in the PDF → not-found → citations fail.
    expect(r.citations.ok).toBe(false);
  });
});
