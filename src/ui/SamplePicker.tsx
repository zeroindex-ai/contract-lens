'use client';

export interface SampleManifestEntry {
  id: string;
  title: string;
  subtitle: string;
  blurb: string;
  page_count: number;
  pdf_path: string;
  json_path: string;
}

export interface SamplePickerProps {
  samples: SampleManifestEntry[];
  onPick: (sample: SampleManifestEntry) => void;
}

export function SamplePicker({ samples, onPick }: SamplePickerProps) {
  return (
    <div className="sample-grid">
      {samples.map((s) => (
        <button
          key={s.id}
          type="button"
          className="sample-card"
          onClick={() => onPick(s)}
          aria-label={`Open sample: ${s.title}`}
        >
          <div className="sample-title">{s.title}</div>
          <div className="sample-subtitle">
            {s.subtitle} · {s.page_count}p
          </div>
          <div className="sample-blurb">{s.blurb}</div>
        </button>
      ))}
    </div>
  );
}
