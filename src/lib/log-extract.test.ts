import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildPayload, logExtract } from './log-extract';
import type { VerifiedContractExtraction } from './verify';
import type { ExtractionMetadata } from './extract';

const verified: VerifiedContractExtraction = {
  parties: [
    {
      name: 'Acme Corp',
      role: 'Seller',
      evidence_quote: 'Acme Corp',
      evidence_page: 1,
      confidence: 1,
      verified_page: 1,
      match_quality: 'exact',
    },
  ],
  effective_date: { value: 'X', evidence_quote: 'X', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
  term: { value: null, evidence_quote: null, evidence_page: null, confidence: 1, verified_page: null, match_quality: 'null-field' },
  payment_terms: { value: 'X', evidence_quote: 'X', evidence_page: 1, confidence: 0.8, verified_page: 1, match_quality: 'fuzzy' },
  deliverables: { value: 'X', evidence_quote: 'X', evidence_page: 1, confidence: 0, verified_page: null, match_quality: 'not-found' },
  ip_ownership: { value: 'X', evidence_quote: 'X', evidence_page: 1, confidence: 0.4, verified_page: 2, match_quality: 'wrong-page' },
  termination_clause: { value: 'X', evidence_quote: 'X', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'normalized' },
  governing_law: { value: 'X', evidence_quote: 'X', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
  kill_fee: { value: null, evidence_quote: null, evidence_page: null, confidence: 1, verified_page: null, match_quality: 'null-field' },
  limitation_of_liability: { value: 'X', evidence_quote: 'X', evidence_page: 1, confidence: 1, verified_page: 1, match_quality: 'exact' },
};

const metadata: ExtractionMetadata = {
  model: 'claude-sonnet-4-6',
  latency_ms: 8234,
  input_tokens: 50_000,
  output_tokens: 1_500,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  request_id: 'req_abc123',
};

describe('buildPayload', () => {
  it('computes mean confidence across all fields', () => {
    const p = buildPayload({ pageCount: 6, outcome: 'ok', verified, metadata });
    // 10 fields total (1 party + 9 scalars). Sum: 1+1+1+0.8+0+0.4+1+1+1+1 = 8.2 / 10 = 0.82
    expect(p.mean_confidence).toBeCloseTo(0.82, 2);
  });

  it('counts fields per match_quality', () => {
    const p = buildPayload({ pageCount: 6, outcome: 'ok', verified, metadata });
    expect(p.match_quality_counts).toEqual({
      exact: 4,
      normalized: 1,
      fuzzy: 1,
      'wrong-page': 1,
      'not-found': 1,
      'null-field': 2,
    });
  });

  it('passes through metadata fields', () => {
    const p = buildPayload({ pageCount: 6, outcome: 'ok', verified, metadata });
    expect(p.request_id).toBe('req_abc123');
    expect(p.model).toBe('claude-sonnet-4-6');
    expect(p.latency_ms).toBe(8234);
    expect(p.input_tokens).toBe(50_000);
  });

  it('handles rate-limited outcome (no verified, no metadata)', () => {
    const p = buildPayload({ pageCount: 0, outcome: 'rate_limited' });
    expect(p.mean_confidence).toBeNull();
    expect(p.match_quality_counts).toEqual({});
    expect(p.model).toBeNull();
    expect(p.outcome).toBe('rate_limited');
  });
});

describe('logExtract', () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    process.env.TRACE_PACK_URL = 'https://traces.example.com';
    process.env.TRACE_PACK_TOKEN = 'tok_test';
  });

  afterEach(() => {
    delete process.env.TRACE_PACK_URL;
    delete process.env.TRACE_PACK_TOKEN;
    global.fetch = originalFetch;
  });

  it('POSTs to /api/ingest with bearer token and JSON body', () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock;

    logExtract({ pageCount: 6, outcome: 'ok', verified, metadata });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://traces.example.com/api/ingest');
    expect(init.method).toBe('POST');
    expect(init.headers).toMatchObject({
      'content-type': 'application/json',
      authorization: 'Bearer tok_test',
    });
    expect(init.keepalive).toBe(true);

    const body = JSON.parse(init.body as string);
    expect(body.source).toBe('contract-lens');
    expect(body.type).toBe('contract_extraction');
  });

  it('strips trailing slash from TRACE_PACK_URL', () => {
    process.env.TRACE_PACK_URL = 'https://traces.example.com/';
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    global.fetch = fetchMock;
    logExtract({ pageCount: 6, outcome: 'ok' });
    expect(fetchMock.mock.calls[0][0]).toBe('https://traces.example.com/api/ingest');
  });

  it('silently skips when TRACE_PACK_URL is unset', () => {
    delete process.env.TRACE_PACK_URL;
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    logExtract({ pageCount: 6, outcome: 'ok' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('silently skips when TRACE_PACK_TOKEN is unset', () => {
    delete process.env.TRACE_PACK_TOKEN;
    const fetchMock = vi.fn();
    global.fetch = fetchMock;
    logExtract({ pageCount: 6, outcome: 'ok' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows fetch errors without throwing', () => {
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    global.fetch = fetchMock;
    // Should not throw — logExtract is fire-and-forget
    expect(() => logExtract({ pageCount: 6, outcome: 'ok' })).not.toThrow();
  });
});
