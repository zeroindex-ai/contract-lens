import { describe, expect, it } from 'vitest';
import {
  bigrams,
  diceCoefficient,
  exactMatch,
  fuzzyMatch,
  match,
  normalize,
  normalizedMatch,
} from './match';

describe('normalize', () => {
  it('lowercases', () => {
    expect(normalize('Hello WORLD')).toBe('hello world');
  });

  it('collapses whitespace', () => {
    expect(normalize('  hello\n\tworld  ')).toBe('hello world');
  });

  it('straightens curly quotes', () => {
    expect(normalize('he said “hello”')).toBe('he said "hello"');
    expect(normalize('it’s here')).toBe("it's here");
  });

  it('converts en/em dashes to hyphens', () => {
    expect(normalize('one—two–three')).toBe('one-two-three');
  });

  it('handles non-breaking spaces', () => {
    expect(normalize('a b')).toBe('a b');
  });
});

describe('exactMatch', () => {
  it('finds verbatim substring', () => {
    expect(exactMatch('Acme Corp', 'between Acme Corp and Beta LLC')).toBe(true);
  });

  it('is case-sensitive', () => {
    expect(exactMatch('acme corp', 'between Acme Corp and Beta LLC')).toBe(false);
  });

  it('returns false for empty needle', () => {
    expect(exactMatch('', 'anything')).toBe(false);
  });
});

describe('normalizedMatch', () => {
  it('matches across smart-quote difference', () => {
    expect(normalizedMatch('Acme Corp ("Seller")', 'between Acme Corp (“Seller”)')).toBe(true);
  });

  it('matches across case difference', () => {
    expect(normalizedMatch('acme corp', 'Acme Corp signed')).toBe(true);
  });

  it('matches across whitespace difference', () => {
    expect(normalizedMatch('Effective Date', 'Effective\n   Date: May 17')).toBe(true);
  });

  it('returns false for absent text', () => {
    expect(normalizedMatch('Gamma Inc', 'Acme Corp and Beta LLC')).toBe(false);
  });
});

describe('bigrams', () => {
  it('produces consecutive character pairs', () => {
    expect(bigrams('hello')).toEqual(['he', 'el', 'll', 'lo']);
  });

  it('returns empty for strings shorter than 2 chars', () => {
    expect(bigrams('a')).toEqual([]);
    expect(bigrams('')).toEqual([]);
  });
});

describe('diceCoefficient', () => {
  it('returns 1 for identical strings', () => {
    expect(diceCoefficient('hello', 'hello')).toBe(1);
  });

  it('returns 1 for two empty strings', () => {
    expect(diceCoefficient('', '')).toBe(1);
  });

  it('returns 0 when one side is empty', () => {
    expect(diceCoefficient('hello', '')).toBe(0);
  });

  it('returns a value in (0,1) for partial overlap', () => {
    const score = diceCoefficient('night', 'nacht');
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('is symmetric', () => {
    expect(diceCoefficient('abcde', 'abxyz')).toBe(diceCoefficient('abxyz', 'abcde'));
  });

  it('handles repeated bigrams correctly (no double-counting)', () => {
    // bigrams("aaa") = ["aa","aa"] (2 bigrams). diceCoefficient with itself should be 1.
    expect(diceCoefficient('aaa', 'aaa')).toBe(1);
    // bigrams("ababab") = ["ab","ba","ab","ba","ab"] (5 bigrams).
    // vs bigrams("abab") = ["ab","ba","ab"] (3 bigrams).
    // intersection counts each bigram only as many times as it appears in both.
    const s = diceCoefficient('ababab', 'abab');
    expect(s).toBeGreaterThan(0.5);
    expect(s).toBeLessThanOrEqual(1);
  });
});

describe('fuzzyMatch', () => {
  it('finds a near-exact match', () => {
    // "Acme Corp" vs haystack containing the exact phrase — should score ~1
    const r = fuzzyMatch('Acme Corp', 'between Acme Corp and Beta LLC signed today');
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThanOrEqual(0.8);
  });

  it('finds a paraphrased match', () => {
    // Model quote "Effective Date: May 17, 2026" vs PDF "Effective Date — May 17 2026"
    const r = fuzzyMatch(
      'Effective Date: May 17, 2026',
      'The Effective Date — May 17 2026 — begins the term.',
      0.7
    );
    expect(r).not.toBeNull();
    expect(r!.score).toBeGreaterThanOrEqual(0.7);
  });

  it('returns null when no window meets threshold', () => {
    const r = fuzzyMatch('completely unrelated text', 'Acme Corp and Beta LLC signed today');
    expect(r).toBeNull();
  });

  it('returns null for needles shorter than 4 chars', () => {
    expect(fuzzyMatch('a', 'anything goes here')).toBeNull();
  });

  it('returns null when haystack is shorter than needle', () => {
    expect(fuzzyMatch('long needle text', 'short')).toBeNull();
  });
});

describe('match (driver)', () => {
  const haystack = 'between Acme Corp ("Seller") and Beta LLC ("Buyer") on the Effective Date of May 17 2026';

  it('returns exact on verbatim substring', () => {
    const r = match('Acme Corp', haystack);
    expect(r.strength).toBe('exact');
    expect(r.score).toBe(1);
  });

  it('returns normalized when case/whitespace differs', () => {
    const r = match('acme corp', haystack);
    expect(r.strength).toBe('normalized');
    expect(r.score).toBe(1);
  });

  it('returns fuzzy on paraphrased text', () => {
    const r = match('Effective Date - May 17, 2026', haystack);
    expect(['fuzzy', 'normalized']).toContain(r.strength);
    expect(r.score).toBeGreaterThanOrEqual(0.7);
  });

  it('returns none when not present', () => {
    const r = match('Gamma Holdings Limited', haystack);
    expect(r.strength).toBe('none');
    expect(r.score).toBe(0);
    expect(r.snippet).toBeNull();
  });

  it('returns none for empty needle', () => {
    const r = match('', haystack);
    expect(r.strength).toBe('none');
  });
});
