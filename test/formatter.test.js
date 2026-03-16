import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '../src/parser.js';
import { format } from '../src/formatter.js';

describe('formatter', () => {
  it('formats sections and tasks to markdown', () => {
    const data = [
      {
        heading: 'MVP',
        level: 2,
        items: [
          { text: 'Task one', completed: false, due: null,  },
          { text: 'Task two', completed: true, due: null,  },
        ],
      },
    ];
    const result = format(data);
    assert.ok(result.includes('## MVP'));
    assert.ok(result.includes('- [ ] Task one'));
    assert.ok(result.includes('- [x] Task two'));
  });

  it('uses correct heading level', () => {
    const data = [{ heading: 'Title', level: 1, items: [] }];
    const result = format(data);
    assert.ok(result.includes('# Title'));
    assert.ok(!result.includes('## Title'));
  });

  it('formats date with year', () => {
    const data = [
      {
        heading: 'List',
        level: 2,
        items: [
          { text: 'Task', completed: false, due: '2027-03-15T00:00:00.000Z',  },
        ],
      },
    ];
    const result = format(data);
    assert.ok(result.includes('(date: 2027-03-15)'));
  });

  it('formats date without year when current year', () => {
    const year = new Date().getFullYear();
    const data = [
      {
        heading: 'List',
        level: 2,
        items: [
          { text: 'Task', completed: false, due: `${year}-06-01T00:00:00.000Z`,  },
        ],
      },
    ];
    const result = format(data);
    assert.ok(result.includes('(date: 06-01)'));
    assert.ok(!result.includes(String(year)));
  });

  it('roundtrips with parser', () => {
    const original = '## MVP\n\n- [ ] Task one\n- [x] Task two\n\n## Phase 2\n\n- [ ] With date (date: 2027-06-01)\n';
    const parsed = parse(original);
    const formatted = format(parsed);
    const reparsed = parse(formatted);

    assert.equal(reparsed.length, parsed.length);
    assert.equal(reparsed[0].items.length, parsed[0].items.length);
    assert.equal(reparsed[0].items[0].text, parsed[0].items[0].text);
    assert.ok(reparsed[1].items[0].due.startsWith('2027-06-01'));
  });
});
