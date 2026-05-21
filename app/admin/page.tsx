import type { Metadata } from 'next';
import Link from 'next/link';
import type { VerifiedContractExtraction } from '@/lib/verify';
import { db } from '@/db/client';
import { fmtTs } from '@/lib/format';
import { summarize } from '@/ui/groups';

// Reads the extractions table at request time; never prerender (would need
// Turso creds at build). Gated by basic auth in proxy.ts.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = { title: 'Admin · Lens · ZeroIndex' };

function startOfUtcDay(): number {
  return Math.floor(new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z').getTime() / 1000);
}

export default async function AdminPage() {
  const client = db();
  const [recent, totalRes, todayRes] = await Promise.all([
    client.execute(
      'SELECT id, page_count, source, metadata_json, extracted_json, trace_id, created_at FROM extractions ORDER BY created_at DESC LIMIT 200'
    ),
    client.execute('SELECT COUNT(*) AS n FROM extractions'),
    client.execute({
      sql: 'SELECT COUNT(*) AS n FROM extractions WHERE created_at >= ?',
      args: [startOfUtcDay()],
    }),
  ]);

  const total = Number(totalRes.rows[0]?.n ?? 0);
  const today = Number(todayRes.rows[0]?.n ?? 0);

  const items = recent.rows.map((r) => {
    const meta = JSON.parse(String(r.metadata_json)) as { model?: string };
    const extraction = JSON.parse(String(r.extracted_json)) as VerifiedContractExtraction;
    return {
      id: String(r.id),
      pageCount: Number(r.page_count),
      source: String(r.source),
      model: meta.model ?? '—',
      when: fmtTs(Number(r.created_at)),
      summary: summarize(extraction),
    };
  });

  return (
    <section className="pt-10 pb-24">
      <div className="label mb-3">Admin</div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Extractions</h1>
      <p className="mt-4 muted text-base leading-relaxed">
        Metadata only — the raw PDF and extracted content are never stored.{' '}
        <span className="mono">{total}</span> total · <span className="mono">{today}</span> today.
      </p>

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
                <th>Verified</th>
                <th>Review</th>
                <th>Absent</th>
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
                    <td className="num-cell" style={{ color: 'var(--accent-go)' }}>
                      {it.summary.verified}
                    </td>
                    <td
                      className="num-cell"
                      style={{ color: it.summary.review > 0 ? 'var(--error)' : 'var(--muted-2)' }}
                    >
                      {it.summary.review}
                    </td>
                    <td className="num-cell muted-2">{it.summary.notInContract}</td>
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
