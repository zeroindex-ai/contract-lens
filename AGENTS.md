# contract-lens — agent guide

Structured PDF extraction with verified citations. Next 16 app on Vercel, Turso for state, Claude Sonnet 4.6 for extraction.

The *why* and the architecture live in `PROJECT.md`. This file is how to work here.

## Guardrails (do not violate)

- **Never commit secrets.** `.env.local` and real Turso/Anthropic/Resend/etc. keys
  stay out of git (`.gitignore` covers them — double-check before `git add -A`).
- **Public repo → sanitize docs.** No machine paths, vault names, private-memory
  refs, or sprint/portfolio framing in any committed `.md`. The `md-review-gate`
  hook enforces this at commit time.
- **Branch before the first commit.** Run `git branch` and confirm — repos are
  sometimes left on an in-flight feature branch. Don't assume `main`.
- **Visual changes: preview before commit.** Run the dev server and get a human
  eyeball/approval BEFORE committing UI changes. Non-visual changes follow normal flow.
- **Scope UI edits to the named element.** "Make X taller" changes only X. Decouple
  shared tokens first; don't grow siblings.
- **Admin stays Basic Auth.** `/admin` is gated by root `proxy.ts` (Basic Auth,
  `ADMIN_PASSWORD` + `timingSafeEqual`). Do NOT add a signin page, cookie, or users
  table until there's a second admin user.
- **Public endpoints need rate limiting + SSRF guards** (P0). A dedupe hash is not a
  rate limit. `/api/extract` is per-IP daily-capped (atomic check-and-increment).

## Commands

```bash
pnpm dev          # local dev (localhost:3000)
pnpm test         # vitest unit tests
pnpm test:e2e     # playwright (chromium, sample path)
pnpm typecheck    # tsc --noEmit
pnpm lint         # eslint
pnpm build        # next build (also the CI gate)
pnpm eval         # score extraction over the golden set (needs ANTHROPIC_API_KEY)
```

## Conventions & gotchas

- **Lazy `db()` singleton.** The libsql client + strict `env()` init are deferred to
  first request, NOT module load — a top-level `env()` makes `next build` require
  runtime secrets and preview deploys fail. Keep DB access behind the lazy proxy.
- **libsql on Vercel needs the undici fetch workaround.** Vercel's fetch
  instrumentation corrupts libsql's request ("expected non-null body source"); the
  client passes `undici`'s `fetch` (decomposed to url+init). Don't replace it with
  the global fetch.
- **Server-side PDF text uses `unpdf`, not raw `pdfjs-dist`.** pdfjs's dynamic worker
  import can't be bundled into a serverless function reliably; `unpdf` ships a
  worker-free serverless build of pdf.js. The browser preview pane still uses
  `pdfjs-dist` directly to render pages and overlay highlights.
- **Stale CSS after a `globals.css` edit** = Next 16 + Turbopack caching. `rm -rf
  .next` + restart dev (hard-refresh/incognito won't fix it).
- **Favicon lives in `app/favicon.ico`**, not `public/` (the app router intercepts it).
- **SSR everything** — no client-side data fetches for first paint; render on the server.

## Where to look

- `PROJECT.md` — why it exists, decisions, architecture, the public contract.
- Chrome/layout: the `zeroindex-app-layout` skill (canonical header/footer/spacing).
- Design tokens: `STYLE_GUIDE.md` in the `zeroindex-site` repo (mirrored in
  `app/globals.css`). Don't invent colors.
- Deploy: the `deploy-zeroindex-vercel-app` skill (Turso → Vercel env → migrations → domain).

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.

## AI pipeline

- **Eval harness is the contract for quality.** `pnpm eval` runs the golden set via
  `@zeroindex-ai/eval-pack`; don't change retrieval/prompts/models without re-running
  it. Record the headline metric (pass threshold 0.75; citation-verification is the
  core check) in PROJECT.md.
- **Model picks are deliberate and documented** in PROJECT.md's decision log — pick by
  eval, not vibe. Claude Sonnet 4.6 via forced `strict` `tool_use`; override with
  `ANTHROPIC_MODEL`. Prompt caching where it helps ([[claude-api]]).
- **Cited output must be escaped** — HTML-escape any model text rendered to the page
  (five-entity coverage). Citations resolve to real source pages before display, and
  each `evidence_quote` is deterministically verified against the PDF text.
