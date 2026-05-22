import { describe, expect, it, vi } from 'vitest';
import type Anthropic from '@anthropic-ai/sdk';
import { extract, ExtractionError } from './extract';
import type { DocumentExtraction } from '@/schema/extraction';

/**
 * Tests use a hand-rolled mock of the Anthropic client's `messages.create`,
 * passed in via `options.client`. No real API calls. Network is never touched.
 *
 * We don't try to validate Anthropic's wire format here — only this module's
 * own behavior: tool_use parsing, Zod validation of the model's input,
 * metadata mapping, and error handling.
 */

const validExtraction: DocumentExtraction = {
  document_type: 'Sales Agreement',
  summary: 'A sales agreement between Acme Corp and Beta LLC.',
  parties: [
    { name: 'Acme Corp', role: 'Seller', evidence_quote: 'Acme Corp ("Seller")', evidence_page: 1 },
  ],
  key_details: [
    { label: 'Effective date', value: '2026-05-17', evidence_quote: 'May 17, 2026', evidence_page: 1 },
    { label: 'Term', value: '3 years', evidence_quote: 'three (3) years', evidence_page: 2 },
    { label: 'Governing law', value: 'Pennsylvania', evidence_quote: 'laws of Pennsylvania', evidence_page: 6 },
  ],
};

/** Build a fake Anthropic response with a single tool_use block. */
function makeResponse(toolInput: unknown, overrides: Record<string, unknown> = {}) {
  return {
    id: 'msg_test',
    type: 'message' as const,
    role: 'assistant' as const,
    model: 'claude-sonnet-4-6',
    stop_reason: 'tool_use' as const,
    stop_sequence: null,
    content: [
      {
        type: 'tool_use' as const,
        id: 'toolu_test',
        name: 'extract_document',
        input: toolInput,
      },
    ],
    usage: {
      input_tokens: 1234,
      output_tokens: 567,
      cache_creation_input_tokens: 0,
      cache_read_input_tokens: 0,
    },
    _request_id: 'req_test',
    ...overrides,
  };
}

/** Mock client whose `messages.create` returns a canned response. */
function makeClient(toolInput: unknown, overrides: Record<string, unknown> = {}) {
  const create = vi.fn().mockResolvedValue(makeResponse(toolInput, overrides));
  return { create, client: { messages: { create } } as unknown as Anthropic };
}

describe('extract', () => {
  const fakePdf = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF magic bytes

  it('returns a validated extraction and metadata on a well-formed response', async () => {
    const { client, create } = makeClient(validExtraction);
    const result = await extract(fakePdf, { client });

    expect(result.extraction).toEqual(validExtraction);
    expect(result.metadata.model).toBe('claude-sonnet-4-6');
    expect(result.metadata.input_tokens).toBe(1234);
    expect(result.metadata.output_tokens).toBe(567);
    expect(result.metadata.request_id).toBe('req_test');
    expect(result.metadata.latency_ms).toBeGreaterThanOrEqual(0);
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('passes the PDF base64 + tool definition + tool_choice to the API call', async () => {
    const { client, create } = makeClient(validExtraction);
    await extract(fakePdf, { client });

    const callArgs = create.mock.calls[0][0];
    expect(callArgs.model).toBe('claude-sonnet-4-6');
    expect(callArgs.tools[0].name).toBe('extract_document');
    expect(callArgs.tool_choice).toEqual({ type: 'tool', name: 'extract_document' });
    // No thinking/output_config — incompatible with forced tool_choice.
    expect(callArgs.thinking).toBeUndefined();

    // PDF is base64 of fakePdf bytes
    const doc = callArgs.messages[0].content[0];
    expect(doc.type).toBe('document');
    expect(doc.source.type).toBe('base64');
    expect(doc.source.media_type).toBe('application/pdf');
    expect(Buffer.from(doc.source.data, 'base64')).toEqual(Buffer.from(fakePdf));
  });

  it('honors options.model override', async () => {
    const { client, create } = makeClient(validExtraction);
    await extract(fakePdf, { client, model: 'claude-opus-4-7' });
    expect(create.mock.calls[0][0].model).toBe('claude-opus-4-7');
  });

  it('throws ExtractionError when the model returns no tool_use block', async () => {
    const response = makeResponse(null, {
      content: [{ type: 'text', text: 'I refuse.' }],
      stop_reason: 'end_turn',
    });
    const create = vi.fn().mockResolvedValue(response);
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(extract(fakePdf, { client })).rejects.toThrow(ExtractionError);
    await expect(extract(fakePdf, { client })).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
    });
  });

  it('throws ExtractionError when the tool input fails Zod validation', async () => {
    const malformed = { ...validExtraction, key_details: [{ label: 'X', value: 'y' }] }; // missing evidence_quote, evidence_page
    const { client } = makeClient(malformed);

    await expect(extract(fakePdf, { client })).rejects.toThrow(ExtractionError);
    await expect(extract(fakePdf, { client })).rejects.toMatchObject({
      code: 'MODEL_RESPONSE_INVALID',
      details: { zodIssues: expect.any(Array) },
    });
  });

  it('propagates SDK errors (e.g., rate limit) unchanged', async () => {
    const create = vi.fn().mockRejectedValue(new Error('rate_limit'));
    const client = { messages: { create } } as unknown as Anthropic;

    await expect(extract(fakePdf, { client })).rejects.toThrow('rate_limit');
  });
});
