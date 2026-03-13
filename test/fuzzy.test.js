import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { levenshtein, similarity, fuzzyMatch } from '../src/fuzzy.js';

describe('levenshtein', () => {
  it('returns 0 for identical strings', () => {
    assert.equal(levenshtein('hello', 'hello'), 0);
  });

  it('returns length for empty vs non-empty', () => {
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('abc', ''), 3);
  });

  it('returns 0 for two empty strings', () => {
    assert.equal(levenshtein('', ''), 0);
  });

  it('computes correct distance', () => {
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(levenshtein('flaw', 'lawn'), 2);
  });

  it('handles single character difference', () => {
    assert.equal(levenshtein('cat', 'bat'), 1);
  });
});

describe('similarity', () => {
  it('returns 1 for identical strings', () => {
    assert.equal(similarity('hello', 'hello'), 1);
  });

  it('returns 0 for completely different strings of same length', () => {
    assert.ok(similarity('abc', 'xyz') < 0.5);
  });

  it('returns high score for minor edits', () => {
    assert.ok(similarity('Setup CI pipeline', 'Set up CI pipeline') > 0.9);
  });

  it('returns 1 for two empty strings', () => {
    assert.equal(similarity('', ''), 1);
  });
});

describe('fuzzyMatch', () => {
  it('matches similar strings', () => {
    const result = fuzzyMatch(['Setup CI pipeline'], ['Set up CI pipeline']);
    assert.equal(result.length, 1);
    assert.equal(result[0].local, 'Setup CI pipeline');
    assert.equal(result[0].remote, 'Set up CI pipeline');
  });

  it('does not match completely different strings', () => {
    const result = fuzzyMatch(['Buy groceries'], ['Fix bug in parser']);
    assert.equal(result.length, 0);
  });

  it('returns empty for empty inputs', () => {
    assert.deepEqual(fuzzyMatch([], ['something']), []);
    assert.deepEqual(fuzzyMatch(['something'], []), []);
    assert.deepEqual(fuzzyMatch([], []), []);
  });

  it('picks best matches greedily', () => {
    const local = ['Setup CI pipeline', 'Configure deploy scripts'];
    const remote = ['Set up CI pipeline', 'Configure deployment scripts'];
    const result = fuzzyMatch(local, remote);
    assert.equal(result.length, 2);
    const pairs = result.map((r) => [r.local, r.remote]).sort();
    assert.deepEqual(pairs, [
      ['Configure deploy scripts', 'Configure deployment scripts'],
      ['Setup CI pipeline', 'Set up CI pipeline'],
    ]);
  });

  it('does not double-match', () => {
    const local = ['Fix login bug', 'Fix signup bug'];
    const remote = ['Fix login bug typo'];
    const result = fuzzyMatch(local, remote);
    assert.equal(result.length, 1);
    assert.equal(result[0].local, 'Fix login bug');
  });

  it('respects threshold', () => {
    const result = fuzzyMatch(['abc'], ['xyz'], 0.9);
    assert.equal(result.length, 0);
  });
});
