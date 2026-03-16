import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '../src/parser.js';

describe('parser', () => {
  it('parses headings into sections', () => {
    const result = parse('## MVP\n- [ ] Task one\n\n## Phase 2\n- [ ] Task two');
    assert.equal(result.length, 2);
    assert.equal(result[0].heading, 'MVP');
    assert.equal(result[0].level, 2);
    assert.equal(result[1].heading, 'Phase 2');
  });

  it('parses # headings', () => {
    const result = parse('# Project\n- [ ] Task one\n\n## Section\n- [ ] Task two');
    assert.equal(result.length, 2);
    assert.equal(result[0].level, 1);
    assert.equal(result[1].level, 2);
  });

  it('parses open and completed tasks', () => {
    const result = parse('## List\n- [ ] Open task\n- [x] Done task');
    assert.equal(result[0].items.length, 2);
    assert.equal(result[0].items[0].completed, false);
    assert.equal(result[0].items[1].completed, true);
  });

  it('parses indented items as flat tasks', () => {
    const result = parse('## List\n- [ ] Parent\n  - [ ] Child one\n  - [x] Child two');
    assert.equal(result[0].items.length, 3);
    assert.equal(result[0].items[0].text, 'Parent');
    assert.equal(result[0].items[1].text, 'Child one');
    assert.equal(result[0].items[2].completed, true);
  });

  it('parses uppercase X as completed', () => {
    const result = parse('## List\n- [X] Done task');
    assert.equal(result[0].items[0].completed, true);
  });

  it('parses * and + list markers', () => {
    const result = parse('## List\n* [ ] Star task\n+ [ ] Plus task\n- [ ] Dash task');
    assert.equal(result[0].items.length, 3);
    assert.equal(result[0].items[0].text, 'Star task');
    assert.equal(result[0].items[1].text, 'Plus task');
    assert.equal(result[0].items[2].text, 'Dash task');
  });

  it('creates default section for tasks without headings', () => {
    const result = parse('- [ ] Task one\n- [ ] Task two');
    assert.equal(result.length, 1);
    assert.equal(result[0].heading, 'Tasks');
    assert.equal(result[0].items.length, 2);
  });

  it('handles BOM at start of file', () => {
    const result = parse('\uFEFF## List\n- [ ] Task');
    assert.equal(result.length, 1);
    assert.equal(result[0].heading, 'List');
  });

  it('handles CRLF line endings', () => {
    const result = parse('## List\r\n- [ ] Task one\r\n- [x] Task two');
    assert.equal(result[0].items.length, 2);
  });

  it('handles bare CR line endings', () => {
    const result = parse('## List\r- [ ] Task');
    assert.equal(result[0].items.length, 1);
  });

  it('strips trailing hashes from headings', () => {
    const result = parse('## Heading ##\n- [ ] Task');
    assert.equal(result[0].heading, 'Heading');
  });

  it('merges duplicate headings', () => {
    const result = parse('## List\n- [ ] Task one\n\n## List\n- [ ] Task two');
    assert.equal(result.length, 1);
    assert.equal(result[0].items.length, 2);
  });

  it('skips tasks with empty text', () => {
    const result = parse('## List\n- [ ] (date: 03-15)');
    assert.equal(result[0].items.length, 0);
  });

  it('parses single-digit dates', () => {
    const result = parse('## List\n- [ ] Task (date: 3-5)');
    const year = new Date().getFullYear();
    assert.ok(result[0].items[0].due.startsWith(`${year}-03-05`));
  });

  it('parses date with year', () => {
    const result = parse('## List\n- [ ] Launch feature (date: 2026-09-01)');
    const task = result[0].items[0];
    assert.equal(task.text, 'Launch feature');
    assert.ok(task.due.startsWith('2026-09-01'));
  });

  it('parses date without year (defaults to current year)', () => {
    const result = parse('## List\n- [ ] Do thing (date: 03-15)');
    const task = result[0].items[0];
    assert.equal(task.text, 'Do thing');
    const year = new Date().getFullYear();
    assert.ok(task.due.startsWith(`${year}-03-15`));
  });

  it('ignores non-checkbox lines before first heading', () => {
    const result = parse('Some intro text\n\n## List\n- [ ] Task');
    assert.equal(result.length, 1);
    assert.equal(result[0].heading, 'List');
    assert.equal(result[0].items.length, 1);
  });

  it('ignores non-task lines under headings', () => {
    const result = parse('## List\nSome description\n- [ ] Task\nAnother line');
    assert.equal(result[0].items.length, 1);
  });

  it('parses our own TODO.md', async () => {
    const content = await readFile(new URL('../TODO.md', import.meta.url), 'utf-8');
    const result = parse(content);
    assert.ok(result.length >= 2, 'Should have at least MVP and Phase 2 lists');
    assert.ok(result[0].items.length > 0, 'MVP should have tasks');
  });
});
