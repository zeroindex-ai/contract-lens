import { describe, expect, it } from 'vitest';
import { bandFor, bandLabel, REVIEW_THRESHOLD } from './confidence';

describe('bandFor', () => {
  it('returns gray for null-field regardless of confidence', () => {
    expect(bandFor('null-field', 1)).toBe('gray');
    expect(bandFor('null-field', 0)).toBe('gray');
  });

  it('returns green for confidence >= 0.9 on verified matches', () => {
    expect(bandFor('exact', 1)).toBe('green');
    expect(bandFor('normalized', 0.95)).toBe('green');
    expect(bandFor('fuzzy', 0.9)).toBe('green');
  });

  it('returns amber for confidence in [0.5, 0.9)', () => {
    expect(bandFor('fuzzy', 0.89)).toBe('amber');
    expect(bandFor('wrong-page', 0.4)).toBe('red'); // wrong-page is 0.4 in verify, sits in red
    expect(bandFor('fuzzy', 0.5)).toBe('amber');
  });

  it('returns red for confidence below 0.5', () => {
    expect(bandFor('not-found', 0)).toBe('red');
    expect(bandFor('wrong-page', 0.4)).toBe('red');
    expect(bandFor('incomplete', 0)).toBe('red');
  });
});

describe('bandLabel', () => {
  it('returns sensible labels for each band', () => {
    expect(bandLabel('green')).toBe('verified');
    expect(bandLabel('amber')).toBe('low confidence');
    expect(bandLabel('red')).toBe('not verified');
    expect(bandLabel('gray')).toBe('not in contract');
  });
});

describe('REVIEW_THRESHOLD', () => {
  it('is 0.5 so red-band fields trigger the warning banner', () => {
    expect(REVIEW_THRESHOLD).toBe(0.5);
  });
});
