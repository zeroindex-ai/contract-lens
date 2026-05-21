// Eval subject for contract-lens.
//
// The eval-pack `Subject` contract is `(question: string) => Promise<AnswerResult>`.
// Here `question` is a sample id (e.g. "mutual-nda"); the subject loads that
// sample PDF, gets back the VerifiedContractExtraction, and returns:
//   - text:     a human-readable summary of the extracted fields (shown in the report)
//   - metadata: { extraction } — the VerifiedContractExtraction the checks inspect
//
// Two modes:
//   - EVAL_TARGET_URL set → POST the PDF to `${EVAL_TARGET_URL}/api/extract`
//     (e.g. https://lens.zeroindex.ai). Scores the deployed stack end-to-end;
//     the API key stays in the server's environment. Subject to the endpoint's
//     per-IP daily rate limit.
//   - otherwise → run the pipeline in-process (extractPdfText → extract() → verify()),
//     which calls the Messages API directly and needs ANTHROPIC_API_KEY locally.

import { readFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Subject } from '@zeroindex-ai/eval-pack';
import { extract } from '@/lib/extract';
import { verify } from '@/lib/verify';
import type { VerifiedContractExtraction } from '@/lib/verify';
import { extractPdfText } from '@/lib/pdf-text';
import { SCALAR_FIELD_KEYS, FIELD_LABELS } from '@/schema/extraction';

const SAMPLES_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'samples');

function summarize(extraction: VerifiedContractExtraction): string {
  const lines: string[] = [];
  const parties = extraction.parties
    .map((p) => `${p.name} (${p.role}) [${p.match_quality}]`)
    .join('; ');
  lines.push(`${FIELD_LABELS.parties}: ${parties || '—'}`);
  for (const key of SCALAR_FIELD_KEYS) {
    const f = extraction[key];
    const value = f.value === null ? 'not in contract' : `${f.value} [${f.match_quality}]`;
    lines.push(`${FIELD_LABELS[key]}: ${value}`);
  }
  return lines.join('\n');
}

async function viaEndpoint(
  baseUrl: string,
  pdfBuffer: Uint8Array,
  filename: string
): Promise<{ extraction: VerifiedContractExtraction; model?: string }> {
  const form = new FormData();
  const blob = new Blob([pdfBuffer as unknown as BlobPart], { type: 'application/pdf' });
  form.append('file', blob, filename);
  const res = await fetch(`${baseUrl.replace(/\/$/, '')}/api/extract`, {
    method: 'POST',
    body: form,
  });
  const body = (await res.json().catch(() => null)) as {
    extraction?: VerifiedContractExtraction;
    metadata?: { model?: string };
    error?: { code: string; message: string };
  } | null;
  if (!res.ok || !body?.extraction) {
    const detail = body?.error ? `${body.error.code}: ${body.error.message}` : `HTTP ${res.status}`;
    throw new Error(`extract endpoint failed for ${filename} — ${detail}`);
  }
  return { extraction: body.extraction, model: body.metadata?.model };
}

async function inProcess(
  pdfBuffer: Uint8Array
): Promise<{ extraction: VerifiedContractExtraction; model?: string }> {
  const { pageTexts } = await extractPdfText(pdfBuffer);
  const { extraction, metadata } = await extract(pdfBuffer);
  return { extraction: verify(extraction, pageTexts), model: metadata.model };
}

export const subject: Subject = async (question) => {
  const filename = `${question}.pdf`;
  const pdfBuffer = new Uint8Array(await readFile(join(SAMPLES_DIR, filename)));

  const targetUrl = process.env.EVAL_TARGET_URL;
  const t0 = Date.now();
  const { extraction, model } = targetUrl
    ? await viaEndpoint(targetUrl, pdfBuffer, filename)
    : await inProcess(pdfBuffer);
  const totalMs = Date.now() - t0;

  return {
    text: summarize(extraction),
    metadata: { extraction, model, totalMs, target: targetUrl ?? 'in-process' },
  };
};
