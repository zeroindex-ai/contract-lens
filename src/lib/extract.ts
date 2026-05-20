import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { ContractExtractionSchema, type ContractExtraction } from '@/schema/extraction';

/**
 * Single Anthropic Messages API call: PDF (base64) → forced `tool_use` with
 * the ContractExtraction schema → Zod-validated typed result.
 *
 * Design decisions:
 * - Native Anthropic citations (`citations: {enabled: true}`) are NOT used.
 *   They're incompatible with structured output (returns 400) and only
 *   attach to text blocks anyway. Per-field anchoring comes from the
 *   model's self-reported `evidence_quote` + `evidence_page` inside the
 *   tool_use input, then the verification layer (src/lib/verify.ts) checks
 *   each quote against the actual PDF text.
 * - `strict: true` is NOT used. Our Zod schema includes numerical
 *   constraints (positive integers via `.positive()`) which strict mode
 *   rejects. Zod parsing of the response is our source of truth.
 * - No retry logic in v0.1. Errors surface plainly; the route handler maps
 *   them to 4xx/500.
 */

const DEFAULT_MODEL = 'claude-sonnet-4-6';

/** Tool name the model is forced to call. */
const TOOL_NAME = 'extract_contract';

const SYSTEM_PROMPT = `You extract structured fields from contracts. The user will upload a PDF contract; you must call the \`${TOOL_NAME}\` tool with the structured extraction.

Rules:

1. For every field, the \`evidence_quote\` MUST be a verbatim substring of the PDF text — do not paraphrase, summarize, or normalize quotes, dates, or punctuation. Copy the text exactly as it appears.

2. \`evidence_page\` is the 1-indexed page number in the PDF where \`evidence_quote\` appears.

3. If a field is genuinely not present in the contract, return all three of \`value\`, \`evidence_quote\`, and \`evidence_page\` as null for that field. Do not invent a value, and do not infer one from related text. "Not in this contract" is a valid and useful answer.

4. For \`parties\`: return one entry per distinct party. Set \`role\` based on how the contract identifies them (e.g., "Seller", "Buyer", "Provider", "Client", "Licensor", "Licensee", "Discloser", "Recipient"). Use "Other" only when the role isn't named.

5. Prefer the shortest \`evidence_quote\` that unambiguously supports the field — typically 5–25 words. A long quote is fine when needed; padded quotes that don't actually contain the value are not.

6. \`payment_terms\`: summarize the obligation (amount, currency, schedule) in \`value\`; quote the operative clause.

7. \`term\`: the duration or end condition. "Until terminated" / "ongoing" are valid values when that's what the contract says.

8. \`kill_fee\`, \`limitation_of_liability\`: many contracts omit these. Don't strain to find them; if absent, return all nulls.`;

const USER_INSTRUCTION = `Extract the structured fields from this contract. Call the \`${TOOL_NAME}\` tool with the result. Remember: \`evidence_quote\` must be verbatim from the PDF.`;

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
  extraction: ContractExtraction;
  metadata: ExtractionMetadata;
}

export interface ExtractOptions {
  /** Override the default model. Defaults to `ANTHROPIC_MODEL` env var, then `claude-sonnet-4-6`. */
  model?: string;
  /** Pre-built Anthropic client (for tests / dependency injection). Defaults to a new client from env. */
  client?: Anthropic;
}

/**
 * Extract a structured ContractExtraction from a PDF buffer.
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
  const inputSchema = stripUnsupportedConstraints(z.toJSONSchema(ContractExtractionSchema));

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
        description: 'Return the structured extraction from the contract PDF.',
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
  });
  const latency_ms = Date.now() - t0;

  const toolUse = response.content.find((b): b is Anthropic.ToolUseBlock => b.type === 'tool_use');
  if (!toolUse) {
    throw new ExtractionError(
      'MODEL_RESPONSE_INVALID',
      `Model did not invoke ${TOOL_NAME}; stop_reason was ${response.stop_reason}`
    );
  }

  const parsed = ContractExtractionSchema.safeParse(toolUse.input);
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
