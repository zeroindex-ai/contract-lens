# contract-lens

Structured PDF extraction with verified citations. Document intelligence demo for [ZeroIndex](https://zeroindex.ai).

## Status

v0.1 shipped — live at **[lens.zeroindex.ai](https://lens.zeroindex.ai)**. See [`PROJECT.md`](./PROJECT.md) for scope, decisions, architecture, and the API contract.

## What it does

Upload any official document — a contract, offer letter, invoice, policy — (or pick a sample) and get back a structured, cited reference: the document type, a one-line summary, the parties, and the meaningful details the model finds. Each item's `evidence_quote` is matched deterministically against the PDF's extracted text — anything whose quote doesn't match is flagged in the UI, not silently passed through. The result can be exported as a styled Excel sheet or a compact PDF lookup sheet.

Companion to the rest of the ZeroIndex stack:

- [`@zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack) runs the accuracy eval against a golden set
- [`trace-pack`](https://github.com/zeroindex-ai/trace-pack) ingests one event per extraction at `traces.zeroindex.ai`
- [`evals-site`](https://github.com/zeroindex-ai/evals-site) publishes the latest eval report at `evals.zeroindex.ai/contract-lens`

## How it works

A visitor uploads a PDF → `POST /api/extract` validates it (PDF magic bytes, ≤ 15 MB, ≤ 50 pages, has extractable text, ≤ 25/IP/day) → Anthropic Messages API (Claude Sonnet 4.6) is called with the base64 PDF and a forced `strict` `tool_use` whose `input_schema` is derived from the Zod `DocumentExtraction` schema — `{ document_type, summary, parties[], key_details[] }`, where `key_details` is an open list the model fills with whatever's meaningful for the document → each returned item's `evidence_quote` is deterministically matched against `unpdf`-extracted per-page text to compute a confidence and match quality → typed JSON is returned to the client, persisted to Turso (raw PDF discarded), and a fire-and-forget event is POSTed to `traces.zeroindex.ai`.

Server-side text extraction uses [`unpdf`](https://github.com/unjs/unpdf) (a worker-free, serverless-safe build of pdf.js); the browser preview pane uses `pdfjs-dist` directly to render pages and overlay the highlighted citation.

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

Extraction accuracy is scored with [`@zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack) against a hand-labeled golden set (`evals/`). Grading is deterministic — document-type and key-fact matching, party recall, a no-fabrication negative control, and citation verification (a hallucinated or mis-paginated quote fails the item). The latest run is published at [evals.zeroindex.ai/contract-lens](https://evals.zeroindex.ai/contract-lens).

```bash
ANTHROPIC_API_KEY="$(op read '...')" pnpm eval     # runs the live pipeline over the golden set
```

Set required env vars in `.env.local` (see `.env.example`).

## License

MIT
