# contract-lens — Project Documentation

> **Status: shipped v0.1** — live at [lens.zeroindex.ai](https://lens.zeroindex.ai). Upload any official document (or open a sample) and get a structured, cited reference back — the document type, a summary, the parties, and the meaningful details — each anchored to and **verified** against the source page.

This document captures the scope, strategic decisions, architecture, public contracts, and known constraints for `contract-lens`. It exists to onboard a future collaborator (or future-you in a clean session) and to record the *reasoning* behind decisions, not just the decisions themselves.

---

## 1. Project overview

### What `contract-lens` is

A minimal, opinionated document-intelligence demo: a consumer uploads any official document (PDF); `contract-lens` classifies it, summarizes it, and extracts the meaningful details as an **open list** — `{ document_type, summary, parties[], key_details[] }`, where the model surfaces whatever matters for that document rather than filling a fixed field list — and, critically, **verifies every extracted item against the source PDF text**. Items whose evidence can't be found are flagged rather than silently passed through.

Companion to the rest of the ZeroIndex stack:

- [`eval-pack`](https://github.com/zeroindex-ai/eval-pack) — pre-prod correctness (the accuracy eval for this extractor)
- [`trace-pack`](https://github.com/zeroindex-ai/trace-pack) — post-prod observability (one event per extraction)

### Why this project

Most document-extraction tools show you fields. Almost none show you *where each value came from* — and fewer still tell you when the model got it wrong. The differentiator here is the **verification layer**: the model self-reports an `evidence_quote` + `evidence_page` for each item it extracts, and a deterministic matcher checks that quote against the actual extracted PDF text. The result is a per-item confidence that's *computed*, not model-asserted, plus explicit detection of hallucinated or mis-paginated citations.

### Goals & success criteria for v0.1

| Goal | Metric | Status |
| --- | --- | --- |
| Public demo live | `lens.zeroindex.ai` returns 200; upload + sample paths work | ✅ |
| Real extraction with verified citations | Every party and key detail carries its `value` + `evidence_quote` + `evidence_page` + computed `confidence` + `verified_page` | ✅ |
| No hallucinated citations slip through | An item whose quote isn't in the PDF is flagged (not-found), not shown as clean | ✅ |
| Single API call per extraction | One Claude call: PDF in → structured tool_use out | ✅ |
| Extract-and-discard | Raw PDF is never persisted — only a hash, page count, the extracted JSON, and metadata | ✅ |

### Out of scope (for v0.1)

- **Per-document custom schemas / field picklists.** One open shape serves every document type; there's no per-type template or user-defined field set.
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
| **Extraction scope** | Fully general document intelligence, not contracts-only | Real-use feedback showed a fixed contract-field list was too limiting. An open `key_details` list lets one tool serve contracts, offer letters, invoices, policies, statements, forms, … without per-type schemas — the model surfaces what's meaningful for the document in front of it. |
| **Model** | `claude-sonnet-4-6` | Well within Sonnet's envelope for structured document extraction; ~40% cheaper per call than the top Opus tier. Override via `ANTHROPIC_MODEL`. |
| **PDF transport** | Base64 inline in the `document` content block | No Files API beta header needed; extract-and-discard is simpler when the PDF never persists. |
| **Citations approach** | Self-reported `evidence_quote`/`evidence_page`, then **deterministically verified** — NOT Anthropic's native citations | Native citations are API-incompatible with structured output (returns 400) and only attach to text blocks, never to tool_use args. Self-reported + verified gives per-field anchoring, *computed* confidence, and hallucination detection in one call. |
| **Structured output** | Forced `tool_use` with `strict: true` | Without strict, the model returns nested arrays/objects as strings that fail validation. Strict guarantees conformance. |
| **Thinking** | Off | Anthropic rejects adaptive thinking when `tool_choice` forces a tool. Reliable structured output wins over thinking for this task. |
| **Schema shape** | Open `{ document_type, summary, parties[], key_details[] }`; `key_details` an unbounded list of `{ label, value, evidence_quote, evidence_page }` | The tool adapts to any document by surfacing whatever's meaningful instead of filling a fixed field list. There are no nullable/absent fields — the model simply omits what isn't present, so there's nothing to mark "not in document" and no union-cardinality limit to fight. |
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
                       ├─ cheap guards: MIME · magic bytes · ≤15 MB
                       │                    (free → run BEFORE the increment, so junk
                       │                     uploads don't burn the visitor's daily slot)
                       ├─ rate limit (per-IP-bucket daily counter, Turso)
                       ├─ extractPdfText()  ── unpdf → per-page text + page count
                       ├─ parse guards: ≤50 pages · has-text
                       │                    (need the unpdf parse → run AFTER the increment)
                       ├─ extract()         ── Anthropic Messages: base64 PDF +
                       │                        forced strict tool_use → Zod-validated
                       ├─ verify()          ── match each evidence_quote vs page text
                       │                        → confidence + match_quality + verified_page
                       ├─ persist           ── Turso row (sha256, page_count, JSON, trace_id);
                       │                        raw PDF discarded
                       └─ logExtract()      ── fire-and-forget event → traces.zeroindex.ai (optional)
                       ▼
       { extraction (verified), metadata }  ──▶  two-pane viewer:
                                                   left  = parties + key details (each a cited card)
                                                   right = PDF page (pdfjs canvas + text layer); every
                                                           citation on the visible page is highlighted at
                                                           once (yellow), the selected one filled violet;
                                                           zoom in/out with horizontal scroll; click a
                                                           highlight to select its field
```

### Verification — the core idea

`verify()` takes the model's extraction and the PDF's per-page text and, for each party and key detail:

1. Tries the **claimed page** first — exact substring → `exact`; whitespace/quote/dash-normalized → `normalized`; sliding-window Sørensen–Dice ≥ threshold → `fuzzy`.
2. On a miss, scans neighboring pages (±2) — found elsewhere → `wrong-page` (the model cited the wrong page).
3. Found nowhere → `not-found` (likely hallucinated).

There is no "absent" state to verify: the model omits details that aren't in the document rather than emitting nulls, so every item it returns is a positive claim to check. Confidence is the match score; the UI colors each item by band and shows a banner when any item couldn't be verified.

---

## 4. Public contracts

### `POST /api/extract`

`multipart/form-data` with a single `file` part (`application/pdf`).

```jsonc
// 200
{
  "extraction": {
    "document_type": "Mutual Non-Disclosure Agreement",   // model's classification
    "summary": "One-line description of the document.",
    "parties":     [{ "name", "role", "evidence_quote", "evidence_page",
                      "confidence", "verified_page", "match_quality" }],
    "key_details": [{ "label", "value", "evidence_quote", "evidence_page",
                      "confidence", "verified_page", "match_quality" }]
    //   key_details is an open list — the model emits whatever's meaningful for
    //   the document (governing law, fee, term, total due, …). verify() adds the
    //   confidence / verified_page / match_quality fields.
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

- **One open schema for all document types** — no per-type templates or user-defined field sets.
- **Text-based PDFs only** — scans without embedded text are rejected.
- **Per-IP daily rate limit** (configurable via `RATE_LIMIT_PER_DAY`, default 25) — atomic check-and-increment (single conditional UPSERT). The cheap guards (MIME / size / magic bytes) run *before* the increment, so a junk or oversized upload is rejected without consuming the visitor's daily slot; only requests that clear those guards reach the rate-limit counter.
- **First call per schema is slow** (~20–30s) while strict mode compiles the schema; cached ~24h after.
- **Basic auth only** on `/admin` — single-owner gate, no user accounts. The admin view itself is a real submissions grid: the most recent extractions with their source, page count, model, detail counts, and verified/needs-review tallies, each row linking to a per-extraction detail page.
- **PDF highlighting matches the first occurrence of a quote** — the source-PDF citation highlighter locates each `evidence_quote` by finding its first match in the page's concatenated (dense-normalized) text (`joined.indexOf(q)` in `PdfPreview.tsx`). If the same snippet appears more than once on a page — e.g. a party name or a boilerplate phrase repeated in the body and a signature block — only the first occurrence is highlighted, even when the citation logically points at a later instance. The verification status (which drives the side panel and the verified/needs-review tallies) is unaffected; this is purely a visual-placement limitation of where the on-page highlight lands.

### v0.2 candidates

- Per-item human override / correction.
- An annotated source-PDF export (today's export is a styled Excel sheet + a compact PDF lookup sheet).
- Cost metrics surfaced in the UI once token usage is exposed.

### Shipped since v0.1

- The fully-general pivot (open `key_details`, any document type).
- "Highlight all citations on the visible page" overview mode.
- Excel (`.xlsx`) + PDF lookup-sheet export.

---

## 6. Evaluation

The extraction quality is scored with [`@zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack) against a hand-labeled golden set of documents (`evals/golden.json`). Grading is fully deterministic — no LLM judge:

- **document_type** — the model's classification contains the expected type.
- **parties** — every expected party is recovered.
- **key_facts** — each expected fact (an amount, a date, a jurisdiction) appears among the extracted key details.
- **must_not** — a no-fabrication negative control: forbidden facts (e.g. a kill fee on a document that has none) must NOT appear.
- **citations_verified** — the core assertion: every party and key detail the model reports must carry a citation that lands in the source PDF on the right page. A hallucinated (not-found) or mis-paginated (wrong-page) quote fails the item. This is the "verified" in the product promise, measured.

The golden set spans 8 documents across types (NDA, SOW, MSA, CLA, employment agreement, SaaS order form, a bare engagement letter, and a non-contract invoice as a negative control) and deliberately exercises the `must_not` control — documents that lack common clauses, to confirm the model doesn't fabricate them. The check logic itself is unit-tested offline (`evals/checks.test.ts`) using the committed sample extractions as fixtures, so CI guards the grader without spending API budget.

The eval runs in CI (`.github/workflows/eval.yml`) with `ANTHROPIC_API_KEY` as a repo secret, then renders and publishes to `evals-site` via `EVALS_SITE_TOKEN` — the same auto-publish pattern as `ask-zeroindex` and `intake-zero`. The pass threshold is **0.75**: `citations_verified` is intentionally strict — a single non-verbatim model quote flags the whole document — so the bar tolerates the ~1 item that flips on model nondeterminism (borderline detail mappings) while still failing on a genuine regression. The richer signal is the per-document report (which items verified, which were flagged); a flagged citation is the verification layer doing its job, not a defect. *(The eval earned its keep during v0.1: it caught a production bug where the model emits `evidence_page: 0` — used to 500 the extraction, now tolerated — and, in the pre-pivot fixed-field schema, a bug where the model signalled an absent field with a placeholder string ("Not specified", "N/A") instead of null; the general schema no longer has an absent-field state, so that class of bug is gone by construction.)*

```bash
# In-process — runs the pipeline directly (deterministic, no rate limit):
ANTHROPIC_API_KEY="$(op read '...')" pnpm eval

# Or score the deployed stack end-to-end (key stays in the server env;
# subject to the endpoint's per-IP daily rate limit):
EVAL_TARGET_URL=https://lens.zeroindex.ai pnpm eval
```

Ground truth is calibrated to the model's natural phrasing: content is pinned only on stable facts (governing-law jurisdiction, headline figures), while free-text fields are asserted by presence/absence. The verification check does the heavy lifting on correctness. The latest run is published at [`evals.zeroindex.ai/contract-lens`](https://evals.zeroindex.ai/contract-lens).

---

## 7. Cross-references

- **Companion (pre-prod correctness):** [`zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack)
- **Companion (post-prod observability):** [`zeroindex-ai/trace-pack`](https://github.com/zeroindex-ai/trace-pack) — `traces.zeroindex.ai`
- **Eval reports:** [`evals.zeroindex.ai/contract-lens`](https://evals.zeroindex.ai/contract-lens)
- **This repo:** [`zeroindex-ai/contract-lens`](https://github.com/zeroindex-ai/contract-lens) — live at `lens.zeroindex.ai`

---

_This document is a living artifact. Update it when scope, contracts, or decisions change materially._
