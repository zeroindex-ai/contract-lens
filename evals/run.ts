// Eval harness for contract-lens — runs the golden contracts through the live
// extraction + verification pipeline and grades field accuracy, party recall,
// and citation verification via @zeroindex-ai/eval-pack.
//
// Run (key piped from your secret store, never written to .env.local):
//   ANTHROPIC_API_KEY="$(op read 'op://ZeroIndex LLC/contract-lens secrets/ANTHROPIC_API_KEY')" \
//     pnpm eval
//
//   pnpm eval cla            # one category
//   pnpm eval "" 2           # first 2 items
//
// Writes the run JSON to evals/results/run-<ts>.json — render that into the
// public eval report at evals.zeroindex.ai/contract-lens.

import { runEval, p50, p95, type RunReport } from '@zeroindex-ai/eval-pack';
import { subject } from './subject';
import { checks } from './checks';

function pad(s: string | number, n: number): string {
  return String(s).padEnd(n);
}

async function main(): Promise<void> {
  const target = process.env.EVAL_TARGET_URL;
  if (!target && !process.env.ANTHROPIC_API_KEY) {
    throw new Error(
      'Set EVAL_TARGET_URL=https://lens.zeroindex.ai to score the deployed endpoint, ' +
        'or provide ANTHROPIC_API_KEY to run the pipeline in-process.'
    );
  }
  console.log(`Target: ${target ?? 'in-process (local Messages API)'}\n`);

  const onlyCategory = process.argv[2] || undefined;
  const limit = process.argv[3] ? parseInt(process.argv[3], 10) : undefined;
  const threshold = Number(process.env.EVAL_PASS_THRESHOLD ?? 0.75);

  const report: RunReport = await runEval({
    golden: 'evals/golden.json',
    subject,
    checks,
    // No judge: grading is fully deterministic (field facts + citation verification).
    resultsDir: 'evals/results',
    filter: {
      ...(onlyCategory ? { category: onlyCategory } : {}),
      ...(limit !== undefined ? { limit } : {}),
    },
    onItem: (e) => {
      if (e.type === 'start') {
        process.stdout.write(`  [${pad(e.index + 1, 2)}/${e.total}] ${pad(e.item.id, 32)} `);
      } else if (e.type === 'pass') {
        console.log(`✓ (${e.result.timings.totalMs}ms)`);
      } else if (e.type === 'fail') {
        console.log(`✗ (${e.result.timings.totalMs}ms)`);
      } else if (e.type === 'error') {
        console.log(`ERROR: ${e.error.message}`);
      }
    },
  });

  const passed = report.results.filter((r) => r.pass).length;
  const total = report.results.length;
  const pct = total > 0 ? Math.round((passed / total) * 100) : 0;
  const latencies = report.results.map((r) => r.timings.totalMs);

  console.log('\n=== Summary ===');
  console.log(`  pass: ${passed}/${total} (${pct}%)   p50 ${p50(latencies)}ms   p95 ${p95(latencies)}ms`);

  const failures = report.results.filter((r) => !r.pass);
  if (failures.length > 0) {
    console.log(`\n=== Failures (${failures.length}) ===`);
    for (const r of failures) {
      console.log(`[${r.id}] ${r.category}`);
      for (const c of r.checks.filter((c) => !c.ok)) {
        console.log(`  - ${c.name}: ${JSON.stringify(c.detail)}`);
      }
    }
  }

  if (report.errors.length > 0) {
    console.log(`\n=== Errors (${report.errors.length}) ===`);
    for (const e of report.errors) console.log(`  [${e.id}] ${e.error}`);
  }

  if (report.jsonPath) console.log(`\nSaved: ${report.jsonPath}`);

  if (total === 0) throw new Error('No eval results — every item errored out');
  if (passed / total < threshold) {
    throw new Error(`Pass rate ${pct}% below threshold ${Math.round(threshold * 100)}%`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
