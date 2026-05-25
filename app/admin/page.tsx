import type { Metadata } from 'next';
import Link from 'next/link';
import type { VerifiedDocumentExtraction } from '@/lib/verify';
import { db } from '@/db/client';
import { fmtTs } from '@/lib/format';
import { summarize } from '@/ui/groups';

// Reads the extractions table at request time; never prerender (would need
// Turso creds at build). Gated by basic auth in proxy.ts.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Contract Lens Admin · ZeroIndex' };

export default async function AdminPage() {
  const client = db();
  const recent = await client.execute(
    'SELECT id, page_count, source, metadata_json, extracted_json, trace_id, created_at FROM extractions ORDER BY created_at DESC LIMIT 200'
  );

  const items = recent.rows.map((r) => {
    // Parse defensively: a single corrupt/legacy row must not 500 the whole list.
    let model = '—';
    let summary = { total: 0, verified: 0, review: 0 };
    try {
      const meta = JSON.parse(String(r.metadata_json)) as { model?: string };
      const extraction = JSON.parse(String(r.extracted_json)) as VerifiedDocumentExtraction;
      model = meta.model ?? '—';
      summary = summarize(extraction);
    } catch {
      // leave the placeholders (model "—", zeroed counts)
    }
    return {
      id: String(r.id),
      pageCount: Number(r.page_count),
      source: String(r.source),
      model,
      when: fmtTs(Number(r.created_at)),
      summary,
    };
  });

  return (
    <section className="pt-10 pb-24">
      <div className="label mb-3">Admin • Contract Lens</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Extractions</h1>

      <div className="card mt-8">
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>ID</th>
                <th>When</th>
                <th>Source</th>
                <th>Pages</th>
                <th>Model</th>
                <th>Details</th>
                <th>Verified</th>
                <th>Review</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8} className="muted" style={{ padding: '24px 0' }}>
                    No extractions yet.
                  </td>
                </tr>
              ) : (
                items.map((it) => (
                  <tr key={it.id}>
                    <td className="num-cell">
                      <Link href={`/admin/${it.id}`} className="row-link">
                        #{it.id.slice(0, 8)}
                      </Link>
                    </td>
                    <td className="ts">{it.when}</td>
                    <td>{it.source}</td>
                    <td className="num-cell">{it.pageCount}</td>
                    <td className="ts">{it.model}</td>
                    <td className="num-cell">{it.summary.total}</td>
                    <td className="num-cell" style={{ color: 'var(--accent-go)' }}>
                      {it.summary.verified}
                    </td>
                    <td
                      className="num-cell"
                      style={{ color: it.summary.review > 0 ? 'var(--error)' : 'var(--muted-2)' }}
                    >
                      {it.summary.review}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
