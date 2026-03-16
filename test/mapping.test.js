import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { itemHash } from '../src/mapping.js';

describe('itemHash', () => {
  it('returns an 8-char hex string', () => {
    const hash = itemHash('Buy milk', false, null, null);
    assert.match(hash, /^[0-9a-f]{8}$/);
  });

  it('is stable — same inputs produce same hash', () => {
    const a = itemHash('Buy milk', false, 'at the store', '2026-03-20');
    const b = itemHash('Buy milk', false, 'at the store', '2026-03-20');
    assert.equal(a, b);
  });

  it('different text produces different hash', () => {
    const a = itemHash('Buy milk', false, null, null);
    const b = itemHash('Buy eggs', false, null, null);
    assert.notEqual(a, b);
  });

  it('different completed status produces different hash', () => {
    const a = itemHash('Buy milk', false, null, null);
    const b = itemHash('Buy milk', true, null, null);
    assert.notEqual(a, b);
  });

  it('different notes produces different hash', () => {
    const a = itemHash('Buy milk', false, 'note A', null);
    const b = itemHash('Buy milk', false, 'note B', null);
    assert.notEqual(a, b);
  });

  it('different due date produces different hash', () => {
    const a = itemHash('Buy milk', false, null, '2026-03-20');
    const b = itemHash('Buy milk', false, null, '2026-04-01');
    assert.notEqual(a, b);
  });

  it('handles null notes and due', () => {
    const a = itemHash('task', false, null, null);
    const b = itemHash('task', false, undefined, undefined);
    assert.equal(a, b);
  });
});
