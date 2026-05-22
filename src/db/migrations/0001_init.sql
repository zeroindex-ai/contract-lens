-- v0.1 schema. Two tables: extractions (one row per /api/extract call) and
-- rate_limits (per-IP-bucket daily counter).
--
-- "extract-and-discard": the raw PDF is never persisted, only its sha256 +
-- page_count + the extracted JSON + a trace_id for cross-reference to
-- traces.zeroindex.ai. ip_bucket is sha256(client_ip + salt) — never the
-- raw IP — so the admin view can detect repeat callers without storing
-- visitor IPs in plaintext.

CREATE TABLE IF NOT EXISTS extractions (
  id              TEXT PRIMARY KEY,
  sha256          TEXT NOT NULL,
  page_count      INTEGER NOT NULL,
  source          TEXT NOT NULL,            -- 'upload' | 'sample:<id>'
  extracted_json  TEXT NOT NULL,            -- VerifiedDocumentExtraction as JSON
  metadata_json   TEXT NOT NULL,            -- ExtractionMetadata as JSON
  trace_id        TEXT,                     -- request_id from Anthropic, also the trace event id
  ip_bucket       TEXT NOT NULL,
  created_at      INTEGER NOT NULL          -- unix seconds
);
CREATE INDEX IF NOT EXISTS idx_extractions_created_at ON extractions(created_at);
CREATE INDEX IF NOT EXISTS idx_extractions_ip_bucket  ON extractions(ip_bucket, created_at);

CREATE TABLE IF NOT EXISTS rate_limits (
  ip_bucket TEXT NOT NULL,
  day       TEXT NOT NULL,                  -- 'YYYY-MM-DD' UTC
  count     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (ip_bucket, day)
);
