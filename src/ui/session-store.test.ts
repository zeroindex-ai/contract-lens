import { describe, it, expect } from 'vitest';
import { arrayBufferToBase64, base64ToBlob } from './session-store';

describe('base64 round-trip', () => {
  it('preserves bytes through encode → decode', async () => {
    const original = new Uint8Array([0, 1, 2, 37, 80, 68, 70, 250, 251, 255, 128]);
    const blob = base64ToBlob(arrayBufferToBase64(original.buffer));
    const back = new Uint8Array(await blob.arrayBuffer());
    expect([...back]).toEqual([...original]);
    expect(blob.type).toBe('application/pdf');
  });

  it('handles an empty buffer', async () => {
    const blob = base64ToBlob(arrayBufferToBase64(new Uint8Array([]).buffer));
    expect(blob.size).toBe(0);
  });
});
