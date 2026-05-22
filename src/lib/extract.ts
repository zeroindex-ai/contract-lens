import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { DocumentExtractionSchema, type DocumentExtraction } from '@/schema/extraction';

/**
 * Single Anthropic Messages API call: PDF (base64) → forced `tool_use` with
 * the DocumentExtraction schema → Zod-validated typed result.
 *
 * Design decisions:
 * - Native Anthropic citations (`citations: {enabled: true}`) are NOT used.
 *   They're incompatible with structured output (returns 400) and only
 *   attach to text blocks anyway. Per-field anchoring comes from the
 *   model's self-reported `evidence_quote` + `evidence_page` inside the
 *   tool_use input, then the verification layer (src/lib/verify.ts) checks
 *   each quote against the actual PDF text.
 * - `strict: true` IS used so the model's tool_use input conforms to the
 *   schema's shape. Strict mode rejects numeric/length JSON-schema keywords,
 *   so those are stripped from the wire schema (see stripUnsupportedConstraints)
 *   while the Zod schema keeps the structural guarantees for our own parse.
 *   Note evidence_page is intentionally not `.positive()` — the model can
 *   still emit an out-of-range page and verify() tolerates it.
 * - No retry logic in v0.1. Errors surface plainly; the route handler maps
 *   them to 4xx/500.
 */

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/**
 * Per-request cap on the Anthropic call, below Vercel's 60s `maxDuration` so a
 * hung upstream call fails server-side (as a timeout APIError → 503) instead of
 * burning the whole function budget. Retries are disabled for the same reason —
 * there's no time left for a second attempt inside the route's window.
 */
const EXTRACT_TIMEOUT_MS = 50_000;

/** Tool name the model is forced to call. */
const TOOL_NAME = 'extract_document';

const SYSTEM_PROMPT = `You turn any official document (a contract, agreement, offer letter, invoice, policy, statement, form, …) into a concise, cited reference. The user uploads a PDF; you must call the \`${TOOL_NAME}\` tool with the structured extraction.

Return:
- \`document_type\`: a short, specific label for what this document is (e.g. "Mutual NDA", "Employment Offer Letter", "SaaS Order Form", "Commercial Invoice").
- \`summary\`: one or two plain-language sentences capturing what the document is and does.
- \`parties\`: the named people and organizations the document is between or about. Set \`role\` from the document's own language (Buyer, Seller, Employer, Employee, Vendor, Licensor, Discloser, …); use "Other" when no role is named.
- \`key_details\`: the most meaningful labeled facts a reader would want as a quick reference instead of re-reading the document — dates, amounts, durations, identifiers, obligations, key terms, deadlines, locations, etc. Choose what matters for THIS document; there is no fixed list.

Rules:

1. Every \`evidence_quote\` MUST be a verbatim substring of the PDF text — do not paraphrase, summarize, or normalize quotes, dates, or punctuation. Copy the text exactly as it appears.

2. \`evidence_page\` is the 1-indexed page number where \`evidence_quote\` appears.

3. Prefer the shortest \`evidence_quote\` that unambiguously supports the value — typically 5–25 words. Padded quotes that don't actually contain the value are not acceptable.

4. \`key_details\`: use a short, human label and a concise value. Capture only what's actually in the document — never invent a detail or infer one from absence. If something isn't present, simply leave it out (do NOT emit a row with a value like "Not specified" or "N/A"). Aim for the ~15 most important details; do not pad with trivia.

5. Order \`key_details\` roughly by importance, most useful first.`;

const USER_INSTRUCTION = `Extract a cited reference from this document. Call the \`${TOOL_NAME}\` tool with the result. Remember: every \`evidence_quote\` must be verbatim from the PDF, and only include details that are actually present.`;

export interface ExtractionMetadata {
  model: string;
  latency_ms: number;
  input_tokens: number;
  output_tokens: number;
  cache_creation_input_tokens: number;
  cache_read_input_tokens: number;
  request_id: string | null;
}

export interface ExtractionResult {
  extraction: DocumentExtraction;
  metadata: ExtractionMetadata;
}

export interface ExtractOptions {
  /** Override the default model. Defaults to `ANTHROPIC_MODEL` env var, then `claude-sonnet-4-6`. */
  model?: string;
  /** Pre-built Anthropic client (for tests / dependency injection). Defaults to a new client from env. */
  client?: Anthropic;
}

/**
 * Extract a structured DocumentExtraction from a PDF buffer.
 *
 * Throws:
 * - `ExtractionError` with `code: 'MODEL_RESPONSE_INVALID'` when the model
 *   didn't call the tool or its tool input fails Zod validation.
 * - Anthropic SDK errors (rate limits, auth, etc.) — caller decides how to surface.
 */
export async function extract(pdfBuffer: Uint8Array, options: ExtractOptions = {}): Promise<ExtractionResult> {
  const client = options.client ?? new Anthropic();
  const model = options.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_MODEL;

  // Wire schema for the tool. We enable `strict: true` so Claude's tool_use
  // input conforms exactly to the schema (without strict it freelances and
  // returns arrays/objects as strings). Strict mode rejects numeric/length
  // constraints, so strip those from the wire schema — the Zod schema keeps
  // them for our own response validation.
  const inputSchema = stripUnsupportedConstraints(z.toJSONSchema(DocumentExtractionSchema));

  const pdfBase64 = Buffer.from(pdfBuffer).toString('base64');

  const t0 = Date.now();
  const response = await client.messages.create({
    model,
    max_tokens: 8192,
    // No `thinking` here: Anthropic rejects adaptive thinking when tool_choice
    // forces a specific tool ("Thinking may not be enabled when tool_choice
    // forces tool use"). We prioritize the guaranteed structured tool_use over
    // thinking — field extraction with verbatim quotes doesn't need it.
    system: SYSTEM_PROMPT,
    tools: [
      {
        name: TOOL_NAME,
        description: 'Return the structured extraction from the document.',
        strict: true,
        // Cast required: Anthropic's TS types want JSONSchema7-shaped input_schema,
        // but z.toJSONSchema returns a more general JSON Schema (draft 2020-12).
        // Anthropic accepts it at runtime.
        input_schema: inputSchema as Anthropic.Tool.InputSchema,
      },
    ],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'document',
            source: { type: 'base64', media_type: 'application/pdf', data: pdfBase64 },
          },
          { type: 'text', text: USER_INSTRUCTION },
        ],
      },
    ],
  }, { timeout: EXTRACT_TIMEOUT_MS, maxRetries: 0 });
  const latency_ms = Date.now() - t0;

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) {
    throw new ExtractionError(
      'MODEL_RESPONSE_INVALID',
      `Model did not invoke ${TOOL_NAME}; stop_reason was ${response.stop_reason}`
    );
  }

  const parsed = DocumentExtractionSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new ExtractionError(
      'MODEL_RESPONSE_INVALID',
      `Model tool_use input failed schema validation: ${parsed.error.message}`,
      { zodIssues: parsed.error.issues }
    );
  }

  return {
    extraction: parsed.data,
    metadata: {
      model: response.model,
      latency_ms,
      input_tokens: response.usage.input_tokens,
      output_tokens: response.usage.output_tokens,
      cache_creation_input_tokens: response.usage.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: response.usage.cache_read_input_tokens ?? 0,
      request_id: response._request_id ?? null,
    },
  };
}

export class ExtractionError extends Error {
  constructor(
    public readonly code: 'MODEL_RESPONSE_INVALID',
    message: string,
    public readonly details?: unknown
  ) {
    super(message);
    this.name = 'ExtractionError';
  }
}

/**
 * Recursively strip JSON Schema keywords that Anthropic strict tool use
 * doesn't support (numeric + length + array-size constraints). Zod adds these
 * from `.int()` / `.positive()` etc.; they're fine for our own validation but
 * a strict-mode tool schema rejects them.
 */
const UNSUPPORTED_KEYS = new Set([
  'minimum',
  'maximum',
  'exclusiveMinimum',
  'exclusiveMaximum',
  'multipleOf',
  'minLength',
  'maxLength',
  'pattern',
  'format',
  'minItems',
  'maxItems',
  'uniqueItems',
]);

function stripUnsupportedConstraints(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(stripUnsupportedConstraints);
  if (schema && typeof schema === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(schema as Record<string, unknown>)) {
      if (UNSUPPORTED_KEYS.has(k)) continue;
      out[k] = stripUnsupportedConstraints(v);
    }
    return out;
  }
  return schema;
}
