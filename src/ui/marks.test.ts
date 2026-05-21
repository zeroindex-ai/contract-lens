import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect } from 'vitest';
import type { VerifiedContractExtraction } from '@/lib/verify';
import { buildCitationMarks } from './marks';

const SAMPLES = join(process.cwd(), 'public', 'samples');
const load = (id: string) =>
  JSON.parse(readFileSync(join(SAMPLES, `${id}.json`), 'utf-8')) as VerifiedContractExtraction;

describe('buildCitationMarks', () => {
  it('emits one mark per party and per present, located scalar field', () => {
    const marks = buildCitationMarks(load('consulting-msa'));
    // Parties both verified.
    expect(marks.filter((m) => m.key.startsWith('party:'))).toHaveLength(2);
    // kill_fee is absent in this sample → no mark; a present field is included.
    expect(marks.some((m) => m.key === 'field:kill_fee')).toBe(false);
    expect(marks.some((m) => m.key === 'field:governing_law')).toBe(true);
    // Every mark carries a real page and a band.
    for (const m of marks) {
      expect(m.page).toBeGreaterThan(0);
      expect(['green', 'amber', 'red', 'gray']).toContain(m.band);
      expect(m.quote.length).toBeGreaterThan(0);
    }
  });

  it('excludes null-fields and not-found citations (no page to point at)', () => {
    // contributor-license-agreement: payment_terms is a hallucinated quote
    // (not-found, verified_page null) and several fields are absent.
    const cla = load('contributor-license-agreement');
    const marks = buildCitationMarks(cla);
    expect(marks.some((m) => m.key === 'field:payment_terms')).toBe(false); // not-found
    expect(marks.some((m) => m.key === 'field:termination_clause')).toBe(false); // null-field
  });

  it('maps a wrong-page citation to its verified page, not the claimed page', () => {
    // fixed-fee-sow: term is claimed on p.2 but verifies on p.1 (wrong-page).
    const marks = buildCitationMarks(load('fixed-fee-sow'));
    const term = marks.find((m) => m.key === 'field:term');
    expect(term?.page).toBe(1);
  });
});
