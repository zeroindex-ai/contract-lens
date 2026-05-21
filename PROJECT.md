# contract-lens — Project Documentation

> **Status: shipped v0.1** — live at [lens.zeroindex.ai](https://lens.zeroindex.ai). Upload a contract PDF (or open a sample) and get structured fields back, each with a citation that is **verified** against the source page.

This document captures the scope, strategic decisions, architecture, public contracts, and known constraints for `contract-lens`. It exists to onboard a future collaborator (or future-you in a clean session) and to record the *reasoning* behind decisions, not just the decisions themselves.

---

## 1. Project overview

### What `contract-lens` is

A minimal, opinionated document-intelligence demo: a consumer uploads a contract PDF; `contract-lens` extracts a fixed set of structured fields (parties, dates, payment terms, IP ownership, termination, governing law, …) and — critically — **verifies every extracted field against the source PDF text**. Fields whose evidence can't be found are flagged rather than silently passed through.

Companion to the rest of the ZeroIndex stack:

- [`eval-pack`](https://github.com/zeroindex-ai/eval-pack) — pre-prod correctness (the accuracy eval for this extractor)
- [`trace-pack`](https://github.com/zeroindex-ai/trace-pack) — post-prod observability (one event per extraction)

### Why this project

Most document-extraction tools show you fields. Almost none show you *where each field came from* — and fewer still tell you when the model got it wrong. The differentiator here is the **verification layer**: the model self-reports an `evidence_quote` + `evidence_page` for each field, and a deterministic matcher checks that quote against the actual extracted PDF text. The result is a per-field confidence that's *computed*, not model-asserted, plus explicit detection of hallucinated or mis-paginated citations.

### Goals & success criteria for v0.1

| Goal | Metric | Status |
| --- | --- | --- |
| Public demo live | `lens.zeroindex.ai` returns 200; upload + sample paths work | ✅ |
| Real extraction with verified citations | Every field carries `value` + `evidence_quote` + `evidence_page` + computed `confidence` + `verified_page` | ✅ |
| No hallucinated citations slip through | A field whose quote isn't in the PDF is flagged (not-found), not shown as clean | ✅ |
| Single API call per extraction | One Claude call: PDF in → structured tool_use out | ✅ |
| Extract-and-discard | Raw PDF is never persisted — only a hash, page count, the extracted JSON, and metadata | ✅ |

### Out of scope (for v0.1)

- **Multiple document types.** Contracts only — no invoices, forms, or leases. The schema is fixed.
- **Editable fields / saved history per user.** Display-only; no accounts.
- **Real-time / streaming UI.** Synchronous extraction (~6–25s) is fine at this scale.
- **Scanned/image-only PDFs.** Text must be extractable; scans are rejected with a clear error.
- **A published API for external consumers.** `/api/extract` exists but has no SDK, no auth tier beyond the per-IP cap.
- **Native Anthropic citations.** Incompatible with structured output — see §2.

---

## 2. Strategic decisions log

Load-bearing decisions, documented because the *why* often outlasts the *what*.

| Decision | Choice | Reasoning |
| --- | --- | --- |
| **Model** | `claude-sonnet-4-6` | Well within Sonnet's envelope for structured contract extraction; ~40% cheaper per call than the top Opus tier. Override via `ANTHROPIC_MODEL`. |
| **PDF transport** | Base64 inline in the `document` content block | No Files API beta header needed; extract-and-discard is simpler when the PDF never persists. |
| **Citations approach** | Self-reported `evidence_quote`/`evidence_page`, then **deterministically verified** — NOT Anthropic's native citations | Native citations are API-incompatible with structured output (returns 400) and only attach to text blocks, never to tool_use args. Self-reported + verified gives per-field anchoring, *computed* confidence, and hallucination detection in one call. |
| **Structured output** | Forced `tool_use` with `strict: true` | Without strict, the model returns nested arrays/objects as strings that fail validation. Strict guarantees conformance. |
| **Thinking** | Off | Anthropic rejects adaptive thinking when `tool_choice` forces a tool. Reliable structured output wins over thinking for this task. |
| **Schema shape** | Whole-field nullability (each field is an object **or** `null`) | Strict mode caps union-typed params at 16; three independently-nullable props per field would exceed it. Whole-field nullability keeps it at one union per field — and is cleaner semantically (present or absent, no partial state). |
| **Schema validation** | Zod, with numeric constraints stripped from the *wire* schema | Strict mode rejects `minimum`/`maximum`/etc.; Zod keeps them for our own response validation, a stripped copy goes to Anthropic. |
| **Server-side PDF text** | `unpdf` (not raw pdfjs-dist) | pdfjs's dynamic worker import can't be bundled into a serverless function reliably. `unpdf` ships a worker-free serverless build of pdf.js. The browser preview still uses pdfjs-dist directly. |
| **Storage** | Turso libsql, one DB | Consistent with the rest of the stack. Schema: `extractions` + `rate_limits`. Raw PDF never stored. |
| **Auth** | None on the demo; basic auth on `/admin` | Single-owner admin view; timing-safe compare via `node:crypto`. |
| **Framework / host** | Next.js 16 (app-router) on Vercel; Node 24; pnpm 10 | Consistent with the sibling projects. |

### Things deliberately NOT chosen

- **Native Anthropic citations** — incompatible with structured output (above).
- **A vector store / RAG** — extraction is a single-document, single-call task; retrieval adds nothing.
- **Streaming the extraction** — the result is structured JSON consumed all at once; nothing to stream.

---

## 3. Architecture

```
 Browser ──upload──▶ POST /api/extract (Next.js route, Node runtime on Vercel)
                       │
                       ├─ rate limit (per-IP-bucket daily counter, Turso)
                       ├─ guards: MIME · magic bytes · ≤10 MB · ≤30 pages · has-text
                       ├─ extractPdfText()  ── unpdf → per-page text + page count
                       ├─ extract()         ── Anthropic Messages: base64 PDF +
                       │                        forced strict tool_use → Zod-validated
                       ├─ verify()          ── match each evidence_quote vs page text
                       │                        → confidence + match_quality + verified_page
                       ├─ persist           ── Turso row (sha256, page_count, JSON, trace_id);
                       │                        raw PDF discarded
                       └─ logExtract()      ── fire-and-forget event → traces.zeroindex.ai (optional)
                       ▼
       { extraction (verified), metadata }  ──▶  two-pane viewer:
                                                   left  = fields grouped by section
                                                   right = PDF page (pdfjs canvas + text layer)
                                                           with the cited quote highlighted in place
```

### Verification — the core idea

`verify()` takes the model's extraction and the PDF's per-page text and, for each field:

1. Tries the **claimed page** first — exact substring → `exact`; whitespace/quote/dash-normalized → `normalized`; sliding-window Sørensen–Dice ≥ threshold → `fuzzy`.
2. On a miss, scans neighboring pages (±2) — found elsewhere → `wrong-page` (the model cited the wrong page).
3. Found nowhere → `not-found` (likely hallucinated).
4. Field returned as `null` → `null-field` (model said it's not in the contract; unverifiable negative, shown as "not in contract").

Confidence is the match score; the UI colors each field by band and shows a banner when any field couldn't be verified.

---

## 4. Public contracts

### `POST /api/extract`

`multipart/form-data` with a single `file` part (`application/pdf`).

```jsonc
// 200
{
  "extraction": {
    "parties": [{ "name", "role", "evidence_quote", "evidence_page",
                  "confidence", "verified_page", "match_quality" }],
    "effective_date": { "value", "evidence_quote", "evidence_page",
                        "confidence", "verified_page", "match_quality" },
    // … term, payment_terms, deliverables, ip_ownership, termination_clause,
    //   governing_law, kill_fee, limitation_of_liability
    //   (each: same shape, or null fields → match_quality "null-field")
  },
  "metadata": { "id", "page_count", "model", "latency_ms",
                "input_tokens", "output_tokens", "trace_id" }
}

// 4xx / 5xx
{ "error": { "code": "NOT_A_PDF" | "FILE_TOO_LARGE" | "TOO_MANY_PAGES"
                   | "EMPTY_FILE" | "SCANNED_PDF_NOT_SUPPORTED" | "WRONG_MIME"
                   | "RATE_LIMITED" | "MODEL_RESPONSE_INVALID"
                   | "SERVICE_UNAVAILABLE" | "INTERNAL",
             "message": "human-readable" } }
```

Upstream API errors (billing, rate limits, auth) are logged server-side and returned as a generic `SERVICE_UNAVAILABLE` — never leaked to the client.

---

## 5. Known constraints & future work

### v0.1 known constraints

- **One document type** (contracts) and **one fixed schema**.
- **Text-based PDFs only** — scans without embedded text are rejected.
- **Per-IP daily rate limit** (configurable via `RATE_LIMIT_PER_DAY`, default 5) — a failed attempt still consumes a slot (increment precedes validation).
- **First call per schema is slow** (~20–30s) while strict mode compiles the schema; cached ~24h after.
- **Basic auth only** on `/admin`; the admin view itself is a placeholder.

### v0.2 candidates

- More document types (invoices, simple forms) behind a type selector.
- A "highlight all citations on this page" overview mode.
- Per-field human override + downloadable CSV/JSON.
- Cost metrics once token usage is surfaced.
- Move the rate-limit increment to *after* the cheap guards so a bad upload doesn't burn a slot.

---

## 6. Cross-references

- **Companion (pre-prod correctness):** [`zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack)
- **Companion (post-prod observability):** [`zeroindex-ai/trace-pack`](https://github.com/zeroindex-ai/trace-pack) — `traces.zeroindex.ai`
- **Eval reports:** [`evals.zeroindex.ai`](https://evals.zeroindex.ai)
- **This repo:** [`zeroindex-ai/contract-lens`](https://github.com/zeroindex-ai/contract-lens) — live at `lens.zeroindex.ai`

---

_This document is a living artifact. Update it when scope, contracts, or decisions change materially._
