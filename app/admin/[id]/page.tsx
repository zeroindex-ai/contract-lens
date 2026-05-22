import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db/client';
import { fmtTs } from '@/lib/format';
import type { MatchQuality, VerifiedDocumentExtraction } from '@/lib/verify';
import { bandFor } from '@/ui/confidence';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Extraction · Admin · Lens · ZeroIndex' };

function Conf({ confidence, matchQuality }: { confidence: number; matchQuality: MatchQuality }) {
  const band = bandFor(confidence);
  const color = band === 'green' ? 'var(--accent-go)' : band === 'red' ? 'var(--error)' : 'var(--warn)';
  return (
    <span style={{ color }}>
      {confidence.toFixed(2)} <span className="muted-2">· {matchQuality}</span>
    </span>
  );
}

export default async function ExtractionDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const client = db();
  const res = await client.execute({
    sql: 'SELECT id, page_count, source, metadata_json, extracted_json, trace_id, sha256, created_at FROM extractions WHERE id = ?',
    args: [id],
  });
  const row = res.rows[0];
  if (!row) notFound();

  let meta: { model?: string };
  let extraction: VerifiedDocumentExtraction;
  try {
    meta = JSON.parse(String(row.metadata_json)) as { model?: string };
    extraction = JSON.parse(String(row.extracted_json)) as VerifiedDocumentExtraction;
  } catch {
    // Corrupt/legacy stored JSON — show a graceful note instead of a 500.
    return (
      <section className="pt-10 pb-24">
        <div className="label mb-3">
          <Link href="/admin" className="subtle">
            ← Admin
          </Link>
        </div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
          Unreadable extraction <span className="muted-2">#{String(row.id).slice(0, 8)}</span>
        </h1>
        <p className="mt-4 muted text-base leading-relaxed">This row&rsquo;s stored JSON couldn&rsquo;t be parsed.</p>
      </section>
    );
  }

  return (
    <section className="pt-10 pb-24">
      <div className="label mb-3">
        <Link href="/admin" className="subtle">
          ← Admin
        </Link>
      </div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
        {extraction.document_type || 'Extraction'}{' '}
        <span className="muted-2">#{String(row.id).slice(0, 8)}</span>
      </h1>
      <p className="mt-4 muted text-base leading-relaxed">
        {String(row.source)} <span className="muted-2">·</span> {fmtTs(Number(row.created_at))}{' '}
        <span className="muted-2">·</span> <span className="mono">{meta.model ?? '—'}</span>{' '}
        <span className="muted-2">·</span> {Number(row.page_count)} pages
        {row.trace_id ? (
          <>
            {' '}
            <span className="muted-2">·</span> trace <span className="mono">{String(row.trace_id).slice(0, 12)}</span>
          </>
        ) : null}
      </p>
      {extraction.summary && <p className="mt-2 muted text-[15px] leading-relaxed">{extraction.summary}</p>}

      <div className="card mt-8">
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Detail</th>
                <th>Value</th>
                <th>Confidence</th>
                <th>Page</th>
              </tr>
            </thead>
            <tbody>
              {extraction.parties.map((p, i) => (
                <tr key={`party-${i}`}>
                  <td>Party · {p.role}</td>
                  <td className="question-wide">{p.name}</td>
                  <td>
                    <Conf confidence={p.confidence} matchQuality={p.match_quality} />
                  </td>
                  <td className="num-cell">{p.verified_page ?? p.evidence_page}</td>
                </tr>
              ))}
              {extraction.key_details.map((d, i) => (
                <tr key={`detail-${i}`}>
                  <td>{d.label}</td>
                  <td className="question-wide">{d.value}</td>
                  <td>
                    <Conf confidence={d.confidence} matchQuality={d.match_quality} />
                  </td>
                  <td className="num-cell">{d.verified_page ?? d.evidence_page}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
