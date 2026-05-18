import { NextResponse } from 'next/server';
import { extract, ExtractionError } from '@/lib/extract';
import { verify } from '@/lib/verify';
import { extractPdfText } from '@/lib/pdf-text';
import {
  assertHasExtractableText,
  assertMagicBytes,
  assertMime,
  assertPageCount,
  assertSize,
  GuardError,
  sha256,
} from '@/lib/pdf-guards';
import { bucketIp, checkAndIncrement } from '@/lib/rate-limit';
import { clientIp } from '@/lib/client-ip';
import { db } from '@/db/client';
import { logExtract } from '@/lib/log-extract';
import { persistExtraction } from '@/lib/persist';

/**
 * POST /api/extract
 *
 * Accepts multipart/form-data with a single `file` part (application/pdf).
 *
 * Pipeline:
 *   1. clientIp → ipBucket  (no raw IPs persisted)
 *   2. checkAndIncrement     → 429 if over daily cap
 *   3. parse multipart       → reject if no file part
 *   4. assertMime / assertSize / assertMagicBytes  → 4xx on guard failure
 *   5. extractPdfText        → also yields pageCount for the page-count guard
 *   6. assertPageCount / assertHasExtractableText
 *   7. extract()             → Anthropic Messages, returns typed extraction + metadata
 *   8. verify()              → match every evidence_quote against the PDF text
 *   9. persistExtraction()   → row in `extractions` (raw PDF discarded)
 *  10. logExtract()          → fire-and-forget POST to traces.zeroindex.ai
 *  11. return JSON           → { extraction, metadata: { id, page_count, trace_id, ... } }
 *
 * Errors at every stage are converted to a stable wire envelope:
 *   { error: { code, message } } with the appropriate HTTP status.
 */

interface ErrorBody {
  error: { code: string; message: string };
}

function errorResponse(status: number, code: string, message: string): NextResponse<ErrorBody> {
  return NextResponse.json({ error: { code, message } }, { status });
}

export async function POST(req: Request): Promise<NextResponse> {
  const ip = clientIp(req.headers);
  const ipBucket = bucketIp(ip);
  let pageCount = 0;

  try {
    // 1+2. Rate limit before anything expensive.
    const rate = await checkAndIncrement(db(), ipBucket);
    if (!rate.allowed) {
      logExtract({ pageCount: 0, outcome: 'rate_limited' });
      return NextResponse.json(
        {
          error: {
            code: 'RATE_LIMITED',
            message: `Daily limit reached. Try again after ${rate.resetsAtUtc}`,
          },
        },
        { status: 429, headers: { 'x-ratelimit-reset': rate.resetsAtUtc } }
      );
    }

    // 3. Parse multipart.
    const form = await req.formData().catch(() => null);
    if (!form) {
      logExtract({ pageCount: 0, outcome: 'bad_request' });
      return errorResponse(400, 'BAD_REQUEST', 'Expected multipart/form-data with a `file` part');
    }
    const file = form.get('file');
    if (!(file instanceof File)) {
      logExtract({ pageCount: 0, outcome: 'bad_request' });
      return errorResponse(400, 'BAD_REQUEST', 'Missing `file` part in multipart body');
    }

    // 4. Cheap guards.
    assertMime(file.type);
    assertSize(file.size);
    const buffer = new Uint8Array(await file.arrayBuffer());
    assertMagicBytes(buffer);

    // 5+6. Page-count + text-density guards (also yields page texts for verify).
    const { pageCount: pages, pageTexts } = await extractPdfText(buffer);
    pageCount = pages;
    assertPageCount(pageCount);
    assertHasExtractableText(pageTexts);

    // 7. The expensive call.
    const { extraction, metadata } = await extract(buffer);

    // 8. Deterministic per-field verification.
    const verified = verify(extraction, pageTexts);

    // 9. Persist (raw PDF discarded).
    const id = await persistExtraction(db(), {
      sha256: sha256(buffer),
      pageCount,
      source: 'upload',
      verified,
      metadata,
      ipBucket,
    });

    // 10. Fire-and-forget observability.
    logExtract({ pageCount, outcome: 'ok', verified, metadata });

    // 11. Return.
    return NextResponse.json({
      extraction: verified,
      metadata: {
        id,
        page_count: pageCount,
        model: metadata.model,
        latency_ms: metadata.latency_ms,
        input_tokens: metadata.input_tokens,
        output_tokens: metadata.output_tokens,
        trace_id: metadata.request_id,
      },
    });
  } catch (err) {
    if (err instanceof GuardError) {
      logExtract({ pageCount, outcome: 'bad_request' });
      return errorResponse(400, err.code, err.message);
    }
    if (err instanceof ExtractionError) {
      logExtract({ pageCount, outcome: 'extract_failed' });
      return errorResponse(502, err.code, err.message);
    }
    // Unknown failure — log and return generic 500. Trace event still fires
    // so the admin dashboard sees the rate of unknown errors.
    console.error('[contract-lens] /api/extract:', err);
    logExtract({ pageCount, outcome: 'extract_failed' });
    return errorResponse(500, 'INTERNAL', err instanceof Error ? err.message : 'Unknown error');
  }
}
