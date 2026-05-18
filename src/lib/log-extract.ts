import type { ExtractionMetadata } from './extract';
import type { MatchQuality, VerifiedContractExtraction } from './verify';

/**
 * Fire-and-forget POST to traces.zeroindex.ai per extraction. Mirrors
 * ask-zeroindex/src/lib/logAsk pattern: keepalive request, errors swallowed,
 * zero latency added to the user-facing response.
 *
 * Trace-pack v0.1's ingest only accepts `ask`-shape events. Whether we
 * extend its schema first or use a tolerant payload shape is the v0.2
 * coordination point for trace-pack — for now we send a `contract_extraction`
 * event type and trace-pack treats unknown types as no-ops (per its
 * passthrough() schema convention). When the multi-source UI lands in
 * trace-pack v0.2, contract-lens is its first proof point.
 */

export interface ExtractEventPayload {
  source: 'contract-lens';
  type: 'contract_extraction';
  request_id: string | null;
  ts_iso: string;
  page_count: number;
  outcome: 'ok' | 'extract_failed' | 'rate_limited' | 'bad_request';
  /** Mean per-field confidence across all verified fields (parties + scalars). */
  mean_confidence: number | null;
  /** Count of fields per match_quality bucket. */
  match_quality_counts: Partial<Record<MatchQuality, number>>;
  /** Metadata pulled from extract.ts — null when extraction wasn't attempted (e.g. rate-limited). */
  model: string | null;
  latency_ms: number | null;
  input_tokens: number | null;
  output_tokens: number | null;
}

export interface LogExtractInput {
  pageCount: number;
  outcome: ExtractEventPayload['outcome'];
  verified?: VerifiedContractExtraction;
  metadata?: ExtractionMetadata;
}

export function buildPayload(input: LogExtractInput): ExtractEventPayload {
  const { verified, metadata } = input;

  let meanConfidence: number | null = null;
  const counts: Partial<Record<MatchQuality, number>> = {};

  if (verified) {
    const allFields = [
      ...verified.parties,
      verified.effective_date,
      verified.term,
      verified.payment_terms,
      verified.deliverables,
      verified.ip_ownership,
      verified.termination_clause,
      verified.governing_law,
      verified.kill_fee,
      verified.limitation_of_liability,
    ];
    const sum = allFields.reduce((s, f) => s + f.confidence, 0);
    meanConfidence = allFields.length === 0 ? null : sum / allFields.length;
    for (const f of allFields) {
      counts[f.match_quality] = (counts[f.match_quality] ?? 0) + 1;
    }
  }

  return {
    source: 'contract-lens',
    type: 'contract_extraction',
    request_id: metadata?.request_id ?? null,
    ts_iso: new Date().toISOString(),
    page_count: input.pageCount,
    outcome: input.outcome,
    mean_confidence: meanConfidence,
    match_quality_counts: counts,
    model: metadata?.model ?? null,
    latency_ms: metadata?.latency_ms ?? null,
    input_tokens: metadata?.input_tokens ?? null,
    output_tokens: metadata?.output_tokens ?? null,
  };
}

/**
 * Fire-and-forget POST. Never throws, never awaits the response body, never
 * blocks the route handler. Logs failures to stderr for debugging but does
 * not surface them to the caller.
 */
export function logExtract(input: LogExtractInput): void {
  const url = process.env.TRACE_PACK_URL;
  const token = process.env.TRACE_PACK_TOKEN;
  if (!url || !token) return; // optional dependency; silently skip if not configured

  const payload = buildPayload(input);

  // We don't `await` this — the route handler returns before the POST completes.
  // `keepalive: true` lets the request finish after the function-instance is
  // torn down on Vercel.
  fetch(`${url.replace(/\/$/, '')}/api/ingest`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch((err) => {
    console.error('[contract-lens] trace-pack POST failed:', err instanceof Error ? err.message : err);
  });
}
