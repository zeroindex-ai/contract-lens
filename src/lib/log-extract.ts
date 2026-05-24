import type { ExtractionMetadata } from './extract';
import type { MatchQuality, VerifiedDocumentExtraction } from './verify';

/**
 * Fire-and-forget POST to traces.zeroindex.ai per extraction. Mirrors
 * ask-zeroindex/src/lib/logAsk: keepalive request, errors swallowed, zero
 * latency added to the user-facing response.
 *
 * Emits trace-pack's v0.2 generic event shape (`event` ≠ "ask"): a universal
 * core (source / event / ts / model / status / latency / token usage) plus
 * contract-lens-specific extension fields. trace-pack stores the core in typed
 * columns (and computes cost from the tokens) and keeps the extension fields in
 * `raw_json` via its passthrough schema. contract-lens is the first non-ask
 * source — it lights up the multi-source overview + the non-RAG dashboard.
 */

type Status = 'ok' | 'error';

export interface ExtractEventPayload {
  // trace-pack v0.2 generic-event core
  source: 'contract-lens';
  event: 'extract';
  ts: string;
  model: string | null;
  status: Status;
  /** Specific failure label when status = error (the route's outcome). */
  outcomeReason?: string;
  totalMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
  cacheCreationInputTokens: number | null;
  cacheReadInputTokens: number | null;
  // contract-lens `extract` extension — preserved in trace-pack's raw_json.
  pageCount: number;
  itemCount: number;
  /** Mean confidence across all verified items (parties + key details). */
  meanConfidence: number | null;
  /** Count of items per match_quality bucket. */
  matchQualityCounts: Partial<Record<MatchQuality, number>>;
  requestId: string | null;
}

export interface LogExtractInput {
  pageCount: number;
  outcome: 'ok' | 'extract_failed' | 'rate_limited' | 'bad_request';
  verified?: VerifiedDocumentExtraction;
  metadata?: ExtractionMetadata;
}

export function buildPayload(input: LogExtractInput): ExtractEventPayload {
  const { verified, metadata } = input;

  let meanConfidence: number | null = null;
  let itemCount = 0;
  const counts: Partial<Record<MatchQuality, number>> = {};

  if (verified) {
    const items = [...verified.parties, ...verified.key_details];
    itemCount = items.length;
    const sum = items.reduce((s, f) => s + f.confidence, 0);
    meanConfidence = items.length === 0 ? null : sum / items.length;
    for (const f of items) {
      counts[f.match_quality] = (counts[f.match_quality] ?? 0) + 1;
    }
  }

  return {
    source: 'contract-lens',
    event: 'extract',
    ts: new Date().toISOString(),
    model: metadata?.model ?? null,
    status: input.outcome === 'ok' ? 'ok' : 'error',
    // 'ok' has no reason; the other outcomes are the failure label trace-pack
    // surfaces as the event's outcome.
    ...(input.outcome === 'ok' ? {} : { outcomeReason: input.outcome }),
    totalMs: metadata?.latency_ms ?? null,
    inputTokens: metadata?.input_tokens ?? null,
    outputTokens: metadata?.output_tokens ?? null,
    cacheCreationInputTokens: metadata?.cache_creation_input_tokens ?? null,
    cacheReadInputTokens: metadata?.cache_read_input_tokens ?? null,
    pageCount: input.pageCount,
    itemCount,
    meanConfidence,
    matchQualityCounts: counts,
    requestId: metadata?.request_id ?? null,
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
