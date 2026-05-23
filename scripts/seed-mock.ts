/**
 * Seed the LOCAL dev DB with mock extraction rows so the /admin grid and the
 * detail pages have enough data to demonstrate scrolling (>10 rows + header).
 *
 * Safe by construction:
 *   - Targets `file:./local.db` ONLY (hard-coded) — it cannot touch prod Turso.
 *   - Tags every row it inserts with a marker ip_bucket and deletes only those
 *     on re-run, so it never disturbs your real local extractions and is
 *     idempotent.
 *
 *   pnpm tsx scripts/seed-mock.ts
 */
import { createClient } from '@libsql/client';
import { randomBytes } from 'node:crypto';

const DB_URL = 'file:./local.db';
const MARKER = 'mock-seed-bucket'; // ip_bucket tag identifying rows this script owns

if (!DB_URL.startsWith('file:')) {
  console.error('Refusing to seed a non-local database.');
  process.exit(1);
}

const hex = (bytes: number) => randomBytes(bytes).toString('hex');

interface Cited {
  evidence_quote: string;
  evidence_page: number;
  confidence: number;
  verified_page: number | null;
  match_quality: 'exact' | 'normalized' | 'fuzzy' | 'wrong-page' | 'not-found';
}

function cite(page: number, quality: Cited['match_quality'] = 'exact'): Cited {
  const confidence = quality === 'exact' ? 1 : quality === 'fuzzy' ? 0.93 : quality === 'wrong-page' ? 0.4 : 0;
  return {
    evidence_quote: `mock evidence on page ${page}`,
    evidence_page: page,
    confidence,
    verified_page: quality === 'not-found' ? null : page,
    match_quality: quality,
  };
}

function mockExtraction(docType: string, summary: string, detailCount: number, pages: number, flagged = 0) {
  const key_details = Array.from({ length: detailCount }, (_, i) => {
    const page = (i % pages) + 1;
    const quality = i < flagged ? (i % 2 === 0 ? 'not-found' : 'wrong-page') : 'exact';
    return { label: `Detail ${i + 1}`, value: `Mock value for detail ${i + 1}`, ...cite(page, quality) };
  });
  return {
    document_type: docType,
    summary,
    parties: [
      { name: 'Acme Holdings, Inc.', role: 'Party A', ...cite(1) },
      { name: 'Globex Ventures LLC', role: 'Party B', ...cite(1) },
    ],
    key_details,
  };
}

// 14 rows: varied types/sizes; two with ~18 details so their detail page scrolls.
const ROWS: Array<{ docType: string; summary: string; details: number; pages: number; flagged: number }> = [
  { docType: 'Mutual NDA', summary: 'Bilateral NDA between two parties.', details: 8, pages: 2, flagged: 0 },
  { docType: 'Employment Agreement', summary: 'At-will employment offer.', details: 9, pages: 2, flagged: 0 },
  { docType: 'Master Services Agreement', summary: 'Hourly consulting MSA with SOWs.', details: 18, pages: 3, flagged: 2 },
  { docType: 'Statement of Work', summary: 'Fixed-fee migration engagement.', details: 11, pages: 2, flagged: 0 },
  { docType: 'SaaS Order Form', summary: 'Annual subscription order.', details: 8, pages: 2, flagged: 0 },
  { docType: 'Commercial Invoice', summary: 'A billing document, not a contract.', details: 6, pages: 1, flagged: 0 },
  { docType: 'Engagement Letter', summary: 'Short advisory letter.', details: 4, pages: 1, flagged: 0 },
  { docType: 'Contributor License Agreement', summary: 'Open-source CLA, perpetual license.', details: 6, pages: 2, flagged: 0 },
  { docType: 'Privacy Policy', summary: 'Consumer privacy policy.', details: 14, pages: 4, flagged: 1 },
  { docType: 'Commercial Lease', summary: 'Office lease agreement.', details: 18, pages: 6, flagged: 3 },
  { docType: 'Loan Agreement', summary: 'Term loan with covenants.', details: 12, pages: 5, flagged: 0 },
  { docType: 'Purchase Order', summary: 'Goods purchase order.', details: 7, pages: 1, flagged: 0 },
  { docType: 'Partnership Agreement', summary: 'General partnership terms.', details: 10, pages: 3, flagged: 0 },
  { docType: 'Insurance Certificate', summary: 'Certificate of liability insurance.', details: 9, pages: 2, flagged: 1 },
];

async function main() {
  const client = createClient({ url: DB_URL });

  const deleted = await client.execute({ sql: 'DELETE FROM extractions WHERE ip_bucket = ?', args: [MARKER] });
  console.log(`Cleared ${deleted.rowsAffected} previously-seeded mock rows.`);

  const now = Math.floor(Date.now() / 1000);
  let i = 0;
  for (const r of ROWS) {
    const verified = mockExtraction(r.docType, r.summary, r.details, r.pages, r.flagged);
    const metadata = {
      model: 'claude-sonnet-4-6',
      latency_ms: 8000 + ((i * 1300) % 16000),
      input_tokens: 6000 + i * 400,
      output_tokens: 900 + i * 60,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
      request_id: `req_mock_${hex(10)}`,
    };
    await client.execute({
      sql: `INSERT INTO extractions
              (id, sha256, page_count, source, extracted_json, metadata_json, trace_id, ip_bucket, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      args: [
        `ext_${hex(12)}`,
        `mock${hex(28)}`,
        r.pages,
        'upload',
        JSON.stringify(verified),
        JSON.stringify(metadata),
        metadata.request_id,
        MARKER,
        now - i * 5400, // spread ~90 min apart, descending
      ],
    });
    i++;
  }

  const total = await client.execute('SELECT COUNT(*) AS n FROM extractions');
  console.log(`Seeded ${ROWS.length} mock rows. Total extractions now: ${total.rows[0]!.n}`);
  console.log('Re-run anytime; it replaces only its own mock rows. Clear them with:');
  console.log(`  DELETE FROM extractions WHERE ip_bucket = '${MARKER}';`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
