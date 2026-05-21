import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db/client';
import { fmtTs } from '@/lib/format';
import { SCALAR_FIELD_KEYS, FIELD_LABELS } from '@/schema/extraction';
import type { VerifiedContractExtraction, VerifiedField } from '@/lib/verify';
import { bandFor } from '@/ui/confidence';

export const dynamic = 'force-dynamic';
export const metadata: Metadata = { title: 'Extraction · Admin · Lens · ZeroIndex' };

function Conf({ field }: { field: { confidence: number; match_quality: VerifiedField['match_quality'] } }) {
  if (field.match_quality === 'null-field') return <span className="muted-2">—</span>;
  const band = bandFor(field.match_quality, field.confidence);
  const color = band === 'green' ? 'var(--accent-go)' : band === 'red' ? 'var(--error)' : 'var(--warn)';
  return (
    <span style={{ color }}>
      {field.confidence.toFixed(2)} <span className="muted-2">· {field.match_quality}</span>
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

  const meta = JSON.parse(String(row.metadata_json)) as { model?: string; latency_ms?: number };
  const extraction = JSON.parse(String(row.extracted_json)) as VerifiedContractExtraction;

  return (
    <section className="pt-10 pb-24">
      <div className="label mb-3">
        <Link href="/admin" className="subtle">
          ← Admin
        </Link>
      </div>
      <h1 className="text-3xl md:text-4xl font-bold tracking-tight">
        Extraction <span className="muted-2">#{String(row.id).slice(0, 8)}</span>
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

      <div className="card mt-8">
        <div className="table-scroll">
          <table className="admin-table">
            <thead>
              <tr>
                <th>Field</th>
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
                    <Conf field={p} />
                  </td>
                  <td className="num-cell">{p.verified_page ?? p.evidence_page ?? '—'}</td>
                </tr>
              ))}
              {SCALAR_FIELD_KEYS.map((key) => {
                const f = extraction[key];
                return (
                  <tr key={key}>
                    <td>{FIELD_LABELS[key]}</td>
                    <td className="question-wide">
                      {f.value === null ? <span className="muted-2">Not in this contract</span> : f.value}
                    </td>
                    <td>
                      <Conf field={f} />
                    </td>
                    <td className="num-cell">{f.verified_page ?? f.evidence_page ?? '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}
