# contract-lens — Project Documentation

> **Phase:** Production
> **Live:** [lens.zeroindex.ai](https://lens.zeroindex.ai) · **Repo:** github.com/zeroindex-ai/contract-lens

Upload any official document (or open a sample) and get a structured, cited reference back — the document type, a summary, the parties, and the meaningful details — each anchored to and **verified** against the source page.

> **Section convention:** every numbered section below is expected. If one genuinely
> doesn't apply, the heading is kept with `— n/a: [reason]` so a reader knows it was
> considered, not forgotten. Repo-specific sections (AI pipeline / eval) come after §8.

---

## 1. Why this exists

Most document-extraction tools show you fields. Almost none show you *where each value came from* — and fewer still tell you when the model got it wrong. The differentiator here is the **verification layer**: the model self-reports an `evidence_quote` + `evidence_page` for each item it extracts, and a deterministic matcher checks that quote against the actual extracted PDF text. The result is a per-item confidence that's *computed*, not model-asserted, plus explicit detection of hallucinated or mis-paginated citations.

A consumer uploads any official document (PDF); `contract-lens` classifies it, summarizes it, and extracts the meaningful details as an **open list** — `{ document_type, summary, parties[], key_details[] }`, where the model surfaces whatever matters for that document rather than filling a fixed field list — then verifies every extracted item against the source PDF text. Items whose evidence can't be found are flagged rather than silently passed through.

### Goals & success criteria

| Goal | How I'll know it's met | Status |
| --- | --- | --- |
| Public demo live | `lens.zeroindex.ai` returns 200; upload + sample paths work | ✅ |
| Real extraction with verified citations | Every party and key detail carries `value` + `evidence_quote` + `evidence_page` + computed `confidence` + `verified_page` | ✅ |
| No hallucinated citations slip through | An item whose quote isn't in the PDF is flagged (not-found), not shown as clean | ✅ |
| Single API call per extraction | One Claude call: PDF in → structured tool_use out | ✅ |
| Extract-and-discard | Raw PDF is never persisted — only a hash, page count, the extracted JSON, and metadata | ✅ |

**Out of scope (v0.1):**

- **Per-document custom schemas / field picklists.** One open shape serves every document type; no per-type template or user-defined field set.
- **Editable fields / saved history per user.** Display-only; no accounts.
- **Real-time / streaming UI.** Synchronous extraction (~6–25s) is fine at this scale.
- **Scanned/image-only PDFs.** Text must be extractable; scans are rejected with a clear error.
- **A published API for external consumers.** `/api/extract` exists but has no SDK, no auth tier beyond the per-IP cap.
- **Native Anthropic citations.** Incompatible with structured output — see §2.

## 2. Strategic decisions

### Tech stack

| Choice | Why this | Alternative rejected |
| --- | --- | --- |
| Next.js 16 (app router) on Vercel; Node 24; pnpm 10 | Consistent with the sibling ZeroIndex projects | — (house default) |
| Turso / libsql, one DB | Consistent with the rest of the stack; raw PDF never stored | Postgres — heavier than this single-owner demo needs |
| Anthropic `claude-sonnet-4-6`, forced strict `tool_use` | Well within Sonnet's envelope for structured extraction; ~40% cheaper per call than the top Opus tier. Override via `ANTHROPIC_MODEL` | Opus — cost without measured benefit on the eval |
| `unpdf` for server-side PDF text | pdfjs's dynamic worker import can't be bundled into a serverless function reliably; `unpdf` ships a worker-free serverless build of pdf.js | raw `pdfjs-dist` server-side — breaks on Vercel serverless |
| vitest · pnpm · Vercel | house default | — |

### Key decisions

Load-bearing choices, with the alternative rejected so they can be re-litigated later with full context. Dated entries are also in the decision log below.

- **Extraction scope — fully general, not contracts-only** (2026-05-21). Real-use feedback showed a fixed contract-field list was too limiting. An open `key_details` list lets one tool serve contracts, offer letters, invoices, policies, statements, forms, … without per-type schemas — the model surfaces what's meaningful for the document in front of it.
- **Citations — self-reported `evidence_quote`/`evidence_page`, then deterministically verified** (2026-05-19). Native Anthropic citations are API-incompatible with structured output (returns 400) and only attach to text blocks, never to tool_use args. Self-reported + verified gives per-field anchoring, *computed* confidence, and hallucination detection in one call.
- **Structured output — forced `tool_use` with `strict: true`** (2026-05-18). Without strict, the model returns nested arrays/objects as strings that fail validation. Strict guarantees conformance.
- **Thinking — off** (2026-05-18). Anthropic rejects adaptive thinking when `tool_choice` forces a tool. Reliable structured output wins over thinking for this task.
- **Schema shape — open `{ document_type, summary, parties[], key_details[] }`**, `key_details` an unbounded list of `{ label, value, evidence_quote, evidence_page }` (2026-05-21). The tool adapts to any document by surfacing whatever's meaningful instead of filling a fixed field list. There are no nullable/absent fields — the model omits what isn't present, so there's nothing to mark "not in document" and no union-cardinality limit to fight.
- **Schema validation — Zod, with numeric constraints stripped from the *wire* schema** (2026-05-18). Strict mode rejects `minimum`/`maximum`/etc.; Zod keeps them for our own response validation, a stripped copy goes to Anthropic.
- **PDF transport — base64 inline in the `document` content block** (2026-05-18). No Files API beta header needed; extract-and-discard is simpler when the PDF never persists.
- **Auth — none on the demo; Basic Auth on `/admin`** (2026-05-18). Single-owner admin view; timing-safe compare via `node:crypto` in root `proxy.ts`.

### Deliberately NOT chosen

- **Native Anthropic citations** — incompatible with structured output (above).
- **A vector store / RAG** — extraction is a single-document, single-call task; retrieval adds nothing.
- **Streaming the extraction** — the result is structured JSON consumed all at once; nothing to stream.

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

`verify()` (`src/lib/verify.ts`) takes the model's extraction and the PDF's per-page text and, for each party and key detail:

1. Tries the **claimed page** first — exact substring → `exact`; whitespace/quote/dash-normalized → `normalized`; sliding-window Sørensen–Dice ≥ threshold → `fuzzy`.
2. On a miss, scans neighboring pages (±2, `NEIGHBOR_RADIUS`) — found elsewhere → `wrong-page` (the model cited the wrong page; `confidence` pinned low at 0.4).
3. Found nowhere → `not-found` (likely hallucinated).

There is no "absent" state to verify: the model omits details that aren't in the document rather than emitting nulls, so every item it returns is a positive claim to check. `confidence` is the match score; the UI colors each item by band and shows a banner when any item couldn't be verified. `pageTexts` is 0-indexed; the model's `evidence_page` is 1-indexed — verify() reconciles, so a bad/0 page degrades to wrong-page/not-found rather than a hard parse failure.

## 4. Public contract

### `POST /api/extract`

`multipart/form-data` with a single `file` part (`application/pdf`). Per-IP daily rate-limited (atomic check-and-increment). No auth.

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
    //   confidence / verified_page / match_quality fields. match_quality ∈
    //   exact | normalized | fuzzy | wrong-page | not-found.
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

### `/admin` · `/admin/[id]` (Basic Auth)

Single-owner submissions grid + per-extraction detail page. Gated by root `proxy.ts` Basic Auth (`ADMIN_PASSWORD` + `timingSafeEqual`); not a public API surface.

## 5. Data model

Turso libsql, one DB. Two tables (`src/db/migrations/0001_init.sql`). **Extract-and-discard:** the raw PDF is never persisted — only its sha256 + page count + extracted JSON + a trace_id for cross-reference to `traces.zeroindex.ai`. `ip_bucket` is `sha256(client_ip + salt)`, never the raw IP, so the admin view can detect repeat callers without storing visitor IPs in plaintext.

```sql
CREATE TABLE extractions (
  id              TEXT PRIMARY KEY,
  sha256          TEXT NOT NULL,
  page_count      INTEGER NOT NULL,
  source          TEXT NOT NULL,    -- 'upload' | 'sample:<id>'
  extracted_json  TEXT NOT NULL,    -- VerifiedDocumentExtraction as JSON
  metadata_json   TEXT NOT NULL,    -- ExtractionMetadata as JSON
  trace_id        TEXT,             -- request_id from Anthropic, also the trace event id
  ip_bucket       TEXT NOT NULL,
  created_at      INTEGER NOT NULL  -- unix seconds
);
CREATE INDEX idx_extractions_created_at ON extractions(created_at);
CREATE INDEX idx_extractions_ip_bucket  ON extractions(ip_bucket, created_at);

CREATE TABLE rate_limits (
  ip_bucket TEXT NOT NULL,
  day       TEXT NOT NULL,          -- 'YYYY-MM-DD' UTC
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_bucket, day)
);
```

The `idx_extractions_ip_bucket` index backs the admin view's repeat-caller detection; `idx_extractions_created_at` backs the recency-ordered grid. The `rate_limits` composite PK `(ip_bucket, day)` is what makes the per-IP daily cap an atomic single-statement conditional UPSERT. No migration-tracking table in v0.1 — each file uses `CREATE … IF NOT EXISTS`, so re-running is a no-op (`pnpm tsx scripts/migrate.ts` for prod; tests run it against an in-memory client).

## 6. Project structure

```
proxy.ts                    — Next middleware: Basic Auth gate on /admin (timing-safe)
next.config.ts              — serverExternalPackages: @libsql/client, undici (Vercel fetch fix)
vercel.json                 — /api/extract maxDuration 60s
app/
  page.tsx                  — demo shell (SSR)
  layout.tsx · HeaderNav    — canonical ZeroIndex chrome
  api/extract/route.ts      — the pipeline: guards → rate-limit → extract → verify → persist → log
  admin/page.tsx            — submissions grid (Basic Auth)
  admin/[id]/page.tsx       — per-extraction detail
  favicon.ico               — app-router favicon (NOT public/)
src/
  schema/extraction.ts      — Zod DocumentExtractionSchema (the open shape; wire-schema source)
  lib/
    extract.ts              — Anthropic Messages call; forced strict tool_use; model default
    verify.ts               — deterministic citation verification → confidence/match_quality
    match.ts                — exact / normalized / fuzzy (Sørensen–Dice) page matcher
    pdf-text.ts             — unpdf per-page text + page count (serverless-safe)
    pdf-guards.ts           — MIME / magic-bytes / ≤15 MB / ≤50 pages / has-text guards
    rate-limit.ts           — atomic per-IP daily UPSERT; RATE_LIMIT_SALT fail-closed in prod
    persist.ts              — write the extractions row (raw PDF discarded)
    log-extract.ts          — fire-and-forget event to traces.zeroindex.ai (optional)
    client-ip.ts · timingSafeCompare.ts · format.ts
  db/
    schema.ts               — applyMigrations + SQL statement splitter
    client.ts               — lazy libsql singleton (undici fetch; deferred env())
    migrations/0001_init.sql
  ui/                        — viewer components: ExtractionViewer, PdfPreview (highlights),
                               FieldRow, ConfidenceChip, export (xlsx/pdf), session-store, …
evals/                       — golden set + deterministic checks (run.ts, checks.test.ts, golden.json)
scripts/                     — migrate.ts, build-sample-*.ts, copy-pdf-worker.mjs, seed-mock.ts
```

## 7. Distribution

Ships as `lens.zeroindex.ai` on Vercel (DNS-only at Cloudflare), backed by a Turso prod DB, via the `deploy-zeroindex-vercel-app` skill (Turso → Vercel env → migrations → domain). Optional dual-write to `traces.zeroindex.ai` for post-prod observability; the eval auto-publishes to `evals-site`.

### Configuration

| Env var | Required? | Purpose / default |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` | yes | Anthropic Messages API |
| `TURSO_DATABASE_URL` · `TURSO_AUTH_TOKEN` | yes | prod DB (`file:./local.db` locally) |
| `ADMIN_PASSWORD` | yes | `/admin` Basic Auth |
| `RATE_LIMIT_SALT` | yes in prod | salt for hashing client IPs into rate-limit buckets; `bucketIp()` throws fail-closed when `NODE_ENV=production` and it's unset (an empty salt makes the IP hash trivially reversible). Falls back to a baked-in default in dev |
| `ANTHROPIC_MODEL` | no | model override; defaults to `claude-sonnet-4-6` |
| `RATE_LIMIT_PER_DAY` | no | per-IP daily extraction cap; defaults to `25` (set high locally for testing) |
| `TRACE_PACK_URL` · `TRACE_PACK_TOKEN` | no | dual-write events to `traces.zeroindex.ai` |

## 8. Testing & evaluation

Unit tests (vitest, `pnpm test`) cover the load-bearing pure logic — verify/match, pdf-guards, rate-limit, schema, timing-safe compare, export, highlight/marks/groups, and the SQL splitter — plus the `/api/extract` route. E2e (`pnpm test:e2e`, Playwright chromium) drives the sample path. `pnpm build` is the CI gate. The eval grader itself is unit-tested offline (`evals/checks.test.ts`) against committed sample extractions, so CI guards the grader without spending API budget.

### AI pipeline — extraction eval

Extraction quality is scored with [`@zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack) against a hand-labeled golden set (`evals/golden.json`). Grading is fully deterministic — no LLM judge:

- **document_type** — the model's classification contains the expected type.
- **parties** — every expected party is recovered.
- **key_facts** — each expected fact (an amount, a date, a jurisdiction) appears among the extracted key details.
- **must_not** — a no-fabrication negative control: forbidden facts (e.g. a kill fee on a document that has none) must NOT appear.
- **citations_verified** — the core assertion: every party and key detail must carry a citation that lands in the source PDF on the right page. A hallucinated (not-found) or mis-paginated (wrong-page) quote fails the item. This is the "verified" in the product promise, measured.

The golden set spans 8 documents across types (NDA, SOW, MSA, CLA, employment agreement, SaaS order form, a bare engagement letter, and a non-contract invoice as a negative control) and deliberately exercises the `must_not` control — documents that lack common clauses, to confirm the model doesn't fabricate them.

The eval runs in CI (`.github/workflows/eval.yml`) with `ANTHROPIC_API_KEY` as a repo secret, then renders and publishes to `evals-site` via `EVALS_SITE_TOKEN` — the same auto-publish pattern as `ask-zeroindex` and `intake-zero`. **Pass threshold 0.75:** `citations_verified` is intentionally strict — a single non-verbatim model quote flags the whole document — so the bar tolerates the ~1 item that flips on model nondeterminism (borderline detail mappings) while still failing on a genuine regression. The richer signal is the per-document report (which items verified, which were flagged); a flagged citation is the verification layer doing its job, not a defect.

Ground truth is calibrated to the model's natural phrasing: content is pinned only on stable facts (governing-law jurisdiction, headline figures), while free-text fields are asserted by presence/absence — the verification check does the heavy lifting on correctness. *(The eval earned its keep during v0.1: it caught a production bug where the model emits `evidence_page: 0` — used to 500 the extraction, now tolerated — and, in the pre-pivot fixed-field schema, a bug where the model signalled an absent field with a placeholder string ("Not specified", "N/A") instead of null; the general schema no longer has an absent-field state, so that class of bug is gone by construction.)*

```bash
# In-process — runs the pipeline directly (deterministic, no rate limit):
ANTHROPIC_API_KEY="$(op read '...')" pnpm eval

# Or score the deployed stack end-to-end (key stays in the server env;
# subject to the endpoint's per-IP daily rate limit):
EVAL_TARGET_URL=https://lens.zeroindex.ai pnpm eval
```

The latest run is published at [`evals.zeroindex.ai/contract-lens`](https://evals.zeroindex.ai/contract-lens).

---

## Ordered work list

Ordered, not calendared. Check off as shipped.

- [x] Fully-general pivot (open `key_details`, any document type).
- [x] "Highlight all citations on the visible page" overview mode.
- [x] Excel (`.xlsx`) + PDF lookup-sheet export.
- [ ] Per-item human override / correction (v0.2).
- [ ] Annotated source-PDF export (today's export is a styled Excel sheet + a compact PDF lookup sheet).
- [ ] Cost metrics surfaced in the UI once token usage is exposed.

## Decision log (running)

Newest first. Every entry is dated.

- **2026-05-21** — Pivoted to a fully-general open schema (`key_details` unbounded, any document type) after real-use feedback that the fixed contract-field list was too limiting. Removed the absent-field placeholder problem by construction (no null state to model).
- **2026-05-19** — Adopted self-reported-then-deterministically-verified citations over Anthropic native citations (native is 400-incompatible with structured output and only attaches to text blocks).
- **2026-05-18** — Locked the core extraction call: forced `tool_use` + `strict: true`, thinking off, base64-inline PDF transport, numeric constraints stripped from the wire schema; Basic Auth on `/admin` with a timing-safe compare.

## Known constraints & future work

- **One open schema for all document types** — no per-type templates or user-defined field sets.
- **Text-based PDFs only** — scans without embedded text are rejected.
- **Per-IP daily rate limit** (`RATE_LIMIT_PER_DAY`, default 25) — atomic check-and-increment (single conditional UPSERT). Cheap guards (MIME / size / magic bytes) run *before* the increment, so a junk or oversized upload is rejected without consuming the visitor's daily slot; only requests that clear those guards reach the rate-limit counter.
- **First call per schema is slow** (~20–30s) while strict mode compiles the schema; cached ~24h after.
- **Basic auth only** on `/admin` — single-owner gate, no user accounts. The admin view is a real submissions grid: most-recent extractions with their source, page count, model, detail counts, and verified/needs-review tallies, each row linking to a per-extraction detail page.
- **PDF highlighting matches the first occurrence of a quote** — the source-PDF highlighter locates each `evidence_quote` by its first match in the page's concatenated (dense-normalized) text (`joined.indexOf(q)` in `PdfPreview.tsx`). If the same snippet appears more than once on a page (e.g. a party name repeated in the body and a signature block), only the first occurrence is highlighted even when the citation logically points at a later instance. The verification *status* (which drives the side panel and the verified/needs-review tallies) is unaffected — this is purely a visual-placement limitation.

## Cross-references

- **Companion (pre-prod correctness):** [`zeroindex-ai/eval-pack`](https://github.com/zeroindex-ai/eval-pack) — the accuracy eval for this extractor.
- **Companion (post-prod observability):** [`zeroindex-ai/trace-pack`](https://github.com/zeroindex-ai/trace-pack) — `traces.zeroindex.ai`, one event per extraction.
- **Eval reports:** [`evals.zeroindex.ai/contract-lens`](https://evals.zeroindex.ai/contract-lens)
- **This repo:** [`zeroindex-ai/contract-lens`](https://github.com/zeroindex-ai/contract-lens) — live at `lens.zeroindex.ai`.

---

_This document is a living artifact. Update it when scope, contracts, or decisions change materially._
</content>
</invoke>
