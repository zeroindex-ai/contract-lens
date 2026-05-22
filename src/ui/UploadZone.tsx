'use client';

import { useRef, useState, type DragEvent } from 'react';
import { MAX_BYTES, MAX_PAGES } from '@/lib/pdf-guards';

export interface UploadZoneProps {
  onFile: (file: File) => void;
  disabled?: boolean;
}

export function UploadZone({ onFile, disabled }: UploadZoneProps) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [dragging, setDragging] = useState(false);

  function handleDragOver(e: DragEvent<HTMLLabelElement>) {
    if (disabled) return;
    e.preventDefault();
    setDragging(true);
  }
  function handleDragLeave() {
    setDragging(false);
  }
  function handleDrop(e: DragEvent<HTMLLabelElement>) {
    if (disabled) return;
    e.preventDefault();
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFile(file);
  }

  return (
    <label
      className={`upload-zone ${dragging ? 'dragging' : ''}`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      style={disabled ? { opacity: 0.5, cursor: 'not-allowed' } : undefined}
    >
      <div className="upload-title">
        {dragging ? 'Drop the PDF to extract' : 'Drop a PDF here, or click to browse'}
      </div>
      <div className="upload-meta">
        max {MAX_BYTES / 1024 / 1024} MB · max {MAX_PAGES} pages · 5 extractions / IP / day
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        disabled={disabled}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) onFile(file);
          // Reset so the same file can be re-uploaded after an error.
          if (inputRef.current) inputRef.current.value = '';
        }}
      />
    </label>
  );
}
