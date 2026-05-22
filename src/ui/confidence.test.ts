import { describe, expect, it } from 'vitest';
import { bandFor, bandLabel, REVIEW_THRESHOLD } from './confidence';

describe('bandFor', () => {
  it('returns green for confidence >= 0.9', () => {
    expect(bandFor(1)).toBe('green');
    expect(bandFor(0.95)).toBe('green');
    expect(bandFor(0.9)).toBe('green');
  });

  it('returns amber for confidence in [0.5, 0.9)', () => {
    expect(bandFor(0.89)).toBe('amber');
    expect(bandFor(0.5)).toBe('amber');
  });

  it('returns red for confidence below 0.5', () => {
    expect(bandFor(0.4)).toBe('red'); // wrong-page sits here
    expect(bandFor(0)).toBe('red'); // not-found
  });
});

describe('bandLabel', () => {
  it('returns sensible labels for each band', () => {
    expect(bandLabel('green')).toBe('verified');
    expect(bandLabel('amber')).toBe('low confidence');
    expect(bandLabel('red')).toBe('not verified');
  });
});

describe('REVIEW_THRESHOLD', () => {
  it('is 0.5 so red-band items trigger the warning banner', () => {
    expect(REVIEW_THRESHOLD).toBe(0.5);
  });
});
