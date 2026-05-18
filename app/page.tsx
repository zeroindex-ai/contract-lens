export default function HomePage() {
  return (
    <>
      <section className="pt-10 pb-8">
        <div className="label mb-3">Lens</div>
        <h1 className="text-3xl md:text-4xl font-bold tracking-tight">Document intelligence — verified.</h1>
        <p className="mt-4 muted text-base leading-relaxed max-w-5xl">
          Upload a contract PDF or pick a sample. Every extracted field is matched back to the source page;
          fields that can&rsquo;t be verified are flagged, not silently passed through.
        </p>
      </section>

      <div className="grad-divider"></div>

      <section className="pt-10 pb-24">
        <div className="card">
          <p className="muted">v0.1 scaffold &mdash; upload + sample + extraction UI lands in task #7.</p>
        </div>
      </section>
    </>
  );
}
