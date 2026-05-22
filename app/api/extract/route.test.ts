import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Client } from '@libsql/client';

// Integration test for the POST /api/extract orchestrator: guards → (mocked)
// extract → real verify → response envelope, plus the rate-limit gate. The
// Anthropic call, persistence, and trace POST are mocked; the rate limiter runs
// against a real in-memory libsql DB so the 429 path is exercised end-to-end.

const hoisted = vi.hoisted(() => ({
  client: null as Client | null,
  extraction: {
    document_type: 'Mutual NDA',
    summary: 'A mutual NDA between Acme Robotics and Globex Partners.',
    parties: [{ name: 'Acme Robotics, Inc.', role: 'Mutual Party', evidence_quote: 'Acme Robotics, Inc.', evidence_page: 1 }],
    key_details: [
      { label: 'Effective date', value: '2026-06-01', evidence_quote: 'June 1, 2026', evidence_page: 1 },
    ],
  },
  metadata: {
    model: 'claude-sonnet-4-6',
    latency_ms: 1234,
    input_tokens: 100,
    output_tokens: 50,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 0,
    request_id: 'req_test_123',
  },
}));

vi.mock('@/db/client', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/db/client')>();
  return { ...actual, db: () => hoisted.client! };
});
vi.mock('@/lib/persist', () => ({ persistExtraction: vi.fn(async () => 1) }));
vi.mock('@/lib/log-extract', () => ({ logExtract: vi.fn() }));
vi.mock('@/lib/extract', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/extract')>();
  return {
    ...actual,
    extract: vi.fn(async () => ({ extraction: hoisted.extraction, metadata: hoisted.metadata })),
  };
});

import { inMemoryClient } from '@/db/client';
import { applyMigrations } from '@/db/schema';
import { POST } from './route';

const SAMPLE_PDF = readFileSync(join(process.cwd(), 'public', 'samples', 'mutual-nda.pdf'));
const ORIGINAL_LIMIT = process.env.RATE_LIMIT_PER_DAY;

function postPdf(): Promise<Response> {
  const form = new FormData();
  form.append('file', new Blob([new Uint8Array(SAMPLE_PDF)], { type: 'application/pdf' }), 'mutual-nda.pdf');
  return POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
}

beforeEach(async () => {
  hoisted.client = inMemoryClient();
  await applyMigrations(hoisted.client);
  process.env.RATE_LIMIT_PER_DAY = '100';
  vi.clearAllMocks();
});

afterAll(() => {
  if (ORIGINAL_LIMIT === undefined) delete process.env.RATE_LIMIT_PER_DAY;
  else process.env.RATE_LIMIT_PER_DAY = ORIGINAL_LIMIT;
});

describe('POST /api/extract', () => {
  it('returns the verified extraction + metadata envelope on the happy path', async () => {
    const res = await postPdf();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.extraction).toBeDefined();
    expect(body.extraction.document_type).toBe('Mutual NDA');
    expect(body.extraction.parties[0].name).toBe('Acme Robotics, Inc.');
    expect(body.metadata.model).toBe('claude-sonnet-4-6');
    expect(body.metadata.page_count).toBe(2);
    expect(body.metadata.trace_id).toBe('req_test_123');
    // verify() ran for real: each key detail carries a computed match_quality.
    expect(body.extraction.key_details[0].match_quality).toBeDefined();
  });

  it('rejects a non-PDF upload with a 400 guard error (no model call)', async () => {
    const { extract } = await import('@/lib/extract');
    const form = new FormData();
    form.append('file', new Blob(['not a pdf'], { type: 'text/plain' }), 'notes.txt');
    const res = await POST(new Request('http://localhost/api/extract', { method: 'POST', body: form }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error.code).toBeDefined();
    expect(extract).not.toHaveBeenCalled();
  });

  it('rate-limits a second request from the same IP once the cap is reached', async () => {
    process.env.RATE_LIMIT_PER_DAY = '1';
    const first = await postPdf();
    expect(first.status).toBe(200);

    const second = await postPdf();
    expect(second.status).toBe(429);
    const body = await second.json();
    expect(body.error.code).toBe('RATE_LIMITED');
  });
});
