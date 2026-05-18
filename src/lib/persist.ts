import type { Client } from '@libsql/client';
import { randomUUID } from 'node:crypto';
import type { ExtractionMetadata } from './extract';
import type { VerifiedContractExtraction } from './verify';

/**
 * Persist one extraction row. Raw PDF is NOT stored — only sha256, page
 * count, the verified JSON, the metadata JSON, and the trace_id.
 */
export interface PersistInput {
  sha256: string;
  pageCount: number;
  source: 'upload' | `sample:${string}`;
  verified: VerifiedContractExtraction;
  metadata: ExtractionMetadata;
  ipBucket: string;
}

export async function persistExtraction(client: Client, input: PersistInput): Promise<string> {
  const id = `ext_${randomUUID().replace(/-/g, '').slice(0, 24)}`;
  const createdAt = Math.floor(Date.now() / 1000);

  await client.execute({
    sql: `INSERT INTO extractions
            (id, sha256, page_count, source, extracted_json, metadata_json, trace_id, ip_bucket, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    args: [
      id,
      input.sha256,
      input.pageCount,
      input.source,
      JSON.stringify(input.verified),
      JSON.stringify(input.metadata),
      input.metadata.request_id,
      input.ipBucket,
      createdAt,
    ],
  });

  return id;
}
