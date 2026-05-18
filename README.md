# contract-lens

Structured PDF extraction with verified citations. Document intelligence demo for [ZeroIndex](https://zeroindex.ai).

## Status

v0.1 in progress. Will live at **lens.zeroindex.ai**.

## What it does

Upload a contract PDF (or pick a sample) and get back typed JSON with every field anchored to a page in the source. Each field's `evidence_quote` is matched deterministically against the PDF's extracted text — fields whose quotes don't match are flagged in the UI, not silently passed through.

Companion to the rest of the ZeroIndex stack:

- [`@zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack) runs the accuracy eval against a golden set
- [`trace-pack`](https://github.com/zeroindex-ai/trace-pack) ingests one event per extraction at `traces.zeroindex.ai`
- [`evals-site`](https://github.com/zeroindex-ai/evals-site) publishes the latest eval report at `evals.zeroindex.ai/contract-lens`

## How it works

A visitor uploads a PDF → `POST /api/extract` validates it (PDF magic bytes, ≤ 10 MB, ≤ 30 pages, ≤ 5/IP/day) → Anthropic Messages API (Claude Sonnet 4.6) is called with the base64 PDF and a forced `tool_use` whose `input_schema` is the Zod `ContractExtraction` schema → each returned field's `evidence_quote` is deterministically matched against `pdfjs-dist`-extracted page text to compute confidence → typed JSON is returned to the client, persisted to Turso (raw PDF discarded), and a fire-and-forget event is POSTed to `traces.zeroindex.ai`.

Native Anthropic citations (`citations: {enabled: true}`) are not used — they are API-incompatible with structured output. The self-reported-plus-verified approach gives per-field anchoring, computed confidence, and hallucination detection in a single API call.

## Local development

```bash
pnpm install
pnpm typecheck
pnpm lint
pnpm test                                         # vitest unit tests
pnpm test:e2e                                     # playwright (chromium, sample path)
pnpm dev                                          # localhost:3000
```

Set required env vars in `.env.local` (see `.env.example`).

## License

MIT
