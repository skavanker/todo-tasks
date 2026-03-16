import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parse } from '../src/parser.js';

describe('parser', () => {
  it('parses headings into sections', () => {
    const { sections } = parse('## MVP\n- [ ] Task one\n\n## Phase 2\n- [ ] Task two');
    assert.equal(sections.length, 2);
    assert.equal(sections[0].heading, 'MVP');
    assert.equal(sections[0].level, 2);
    assert.equal(sections[1].heading, 'Phase 2');
  });

  it('parses # headings', () => {
    const { sections } = parse('# Project\n- [ ] Task one\n\n## Section\n- [ ] Task two');
    assert.equal(sections.length, 2);
    assert.equal(sections[0].level, 1);
    assert.equal(sections[1].level, 2);
  });

  it('parses open and completed tasks', () => {
    const { sections } = parse('## List\n- [ ] Open task\n- [x] Done task');
    assert.equal(sections[0].items.length, 2);
    assert.equal(sections[0].items[0].completed, false);
    assert.equal(sections[0].items[1].completed, true);
  });

  it('parses indented items as flat tasks', () => {
    const { sections } = parse('## List\n- [ ] Parent\n  - [ ] Child one\n  - [x] Child two');
    assert.equal(sections[0].items.length, 3);
    assert.equal(sections[0].items[0].text, 'Parent');
    assert.equal(sections[0].items[1].text, 'Child one');
    assert.equal(sections[0].items[2].completed, true);
  });

  it('parses uppercase X as completed', () => {
    const { sections } = parse('## List\n- [X] Done task');
    assert.equal(sections[0].items[0].completed, true);
  });

  it('parses * and + list markers', () => {
    const { sections } = parse('## List\n* [ ] Star task\n+ [ ] Plus task\n- [ ] Dash task');
    assert.equal(sections[0].items.length, 3);
    assert.equal(sections[0].items[0].text, 'Star task');
    assert.equal(sections[0].items[1].text, 'Plus task');
    assert.equal(sections[0].items[2].text, 'Dash task');
  });

  it('creates default section for tasks without headings', () => {
    const { sections } = parse('- [ ] Task one\n- [ ] Task two');
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, 'Tasks');
    assert.equal(sections[0].items.length, 2);
  });

  it('handles BOM at start of file', () => {
    const { sections } = parse('\uFEFF## List\n- [ ] Task');
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, 'List');
  });

  it('handles CRLF line endings', () => {
    const { sections } = parse('## List\r\n- [ ] Task one\r\n- [x] Task two');
    assert.equal(sections[0].items.length, 2);
  });

  it('handles bare CR line endings', () => {
    const { sections } = parse('## List\r- [ ] Task');
    assert.equal(sections[0].items.length, 1);
  });

  it('strips trailing hashes from headings', () => {
    const { sections } = parse('## Heading ##\n- [ ] Task');
    assert.equal(sections[0].heading, 'Heading');
  });

  it('merges duplicate headings', () => {
    const { sections } = parse('## List\n- [ ] Task one\n\n## List\n- [ ] Task two');
    assert.equal(sections.length, 1);
    assert.equal(sections[0].items.length, 2);
  });

  it('skips tasks with empty text', () => {
    const { sections } = parse('## List\n- [ ] (date: 03-15)');
    assert.equal(sections[0].items.length, 0);
  });

  it('parses single-digit dates', () => {
    const { sections } = parse('## List\n- [ ] Task (date: 3-5)');
    const year = new Date().getFullYear();
    assert.ok(sections[0].items[0].due.startsWith(`${year}-03-05`));
  });

  it('parses date with year', () => {
    const { sections } = parse('## List\n- [ ] Launch feature (date: 2026-09-01)');
    const task = sections[0].items[0];
    assert.equal(task.text, 'Launch feature');
    assert.ok(task.due.startsWith('2026-09-01'));
  });

  it('parses date without year (defaults to current year)', () => {
    const { sections } = parse('## List\n- [ ] Do thing (date: 03-15)');
    const task = sections[0].items[0];
    assert.equal(task.text, 'Do thing');
    const year = new Date().getFullYear();
    assert.ok(task.due.startsWith(`${year}-03-15`));
  });

  it('ignores non-checkbox lines before first heading', () => {
    const { sections } = parse('Some intro text\n\n## List\n- [ ] Task');
    assert.equal(sections.length, 1);
    assert.equal(sections[0].heading, 'List');
    assert.equal(sections[0].items.length, 1);
  });

  it('ignores non-task lines under headings', () => {
    const { sections } = parse('## List\nSome description\n- [ ] Task\nAnother line');
    assert.equal(sections[0].items.length, 1);
  });

  it('parses single-line notes', () => {
    const { sections } = parse('## List\n- [ ] Task\n  This is a note');
    assert.equal(sections[0].items[0].notes, 'This is a note');
  });

  it('parses multi-line notes', () => {
    const { sections } = parse('## List\n- [ ] Task\n  Line one\n  Line two');
    assert.equal(sections[0].items[0].notes, 'Line one\nLine two');
  });

  it('does not attach notes to wrong task', () => {
    const { sections } = parse('## List\n- [ ] Task A\n  Note for A\n- [ ] Task B');
    assert.equal(sections[0].items[0].notes, 'Note for A');
    assert.equal(sections[0].items[1].notes, null);
  });

  it('parses config comments', () => {
    const { config, sections } = parse('<!-- todo-tasks list: My Project -->\n<!-- todo-tasks completed: delete -->\n## List\n- [ ] Task');
    assert.equal(config.list, 'My Project');
    assert.equal(config.completed, 'delete');
    assert.equal(sections.length, 1);
  });

  it('parses our own TODO.md', async () => {
    const content = await readFile(new URL('../TODO.md', import.meta.url), 'utf-8');
    const { sections } = parse(content);
    assert.ok(sections.length >= 2, 'Should have at least MVP and Phase 2 lists');
    assert.ok(sections[0].items.length > 0, 'MVP should have tasks');
  });
});
