import { NextResponse } from 'next/server';

// Placeholder. Full pipeline (guards → extract → verify → persist → trace)
// lands in task #5 (guards + wiring) and task #4 (extraction pipeline).
export async function POST() {
  return NextResponse.json(
    { error: { code: 'NOT_IMPLEMENTED', message: 'Extraction endpoint not yet wired.' } },
    { status: 501 }
  );
}
