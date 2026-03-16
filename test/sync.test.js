import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { sync } from '../src/sync.js';
import { itemHash } from '../src/mapping.js';

/**
 * Builds a stub deps object. Every API method is a no-op by default.
 * Override individual methods via the `overrides` parameter.
 */
function makeDeps(overrides = {}) {
  let written = null;
  let savedMapping = null;
  let taskIdCounter = 0;

  const api = {
    getTasks: async () => [],
    getTaskLists: async () => [],
    createTaskList: async (_auth, title) => ({ id: `list-${++taskIdCounter}`, title }),
    createTask: async (_auth, _listId, body) => ({ id: `task-${++taskIdCounter}`, ...body }),
    updateTask: async () => ({}),
    deleteTask: async () => {},
    clearCompleted: async () => {},
    ...overrides.api,
  };

  const base = {
    api,
    loadMapping: async () => ({ file: '/test/TODO.md', lastSync: null, sections: {} }),
    saveMapping: async (_path, mapping) => { savedMapping = mapping; },
    readFile: async () => '',
    writeFile: async (_path, content) => { written = content; },
    existsSync: () => false,
    ...overrides,
  };

  // Keep api overrides merged properly
  if (overrides.api) base.api = api;

  return {
    deps: base,
    getWritten: () => written,
    getSavedMapping: () => savedMapping,
  };
}

const AUTH = { fake: true };
const FILE = '/projects/myapp/TODO.md';

describe('sync', () => {
  it('fresh sync — local items create remote tasks', async () => {
    const created = [];
    const { deps } = makeDeps({
      existsSync: () => true,
      readFile: async () => '## Work\n\n- [ ] Build feature\n- [ ] Write tests\n',
      api: {
        createTask: async (_auth, _listId, body) => {
          const task = { id: `task-${created.length + 1}`, ...body };
          created.push(task);
          return task;
        },
      },
    });

    const result = await sync(AUTH, FILE, deps);
    assert.equal(result.sections, 1);
    assert.equal(result.items, 2);
    // Parent section + 2 items = 3 creates
    assert.equal(created.length, 3);
    assert.equal(created[0].title, 'Work'); // section parent
    assert.equal(created[1].title, 'Build feature');
    assert.equal(created[2].title, 'Write tests');
  });

  it('new remote items — appear in written output', async () => {
    const { deps, getWritten } = makeDeps({
      existsSync: () => true,
      readFile: async () => '## Work\n\n- [ ] Local task\n',
      loadMapping: async () => ({
        file: FILE,
        lastSync: null,
        taskListId: 'list-1',
        sections: {
          Work: { taskId: 'sec-1', items: { 'Local task': { taskId: 't1', hash: itemHash('Local task', false, null, null), status: 'needsAction' } } },
        },
      }),
      api: {
        getTasks: async () => [
          { id: 'sec-1', title: 'Work', status: 'needsAction' },
          { id: 't1', title: 'Local task', parent: 'sec-1', status: 'needsAction' },
          { id: 't2', title: 'Remote task', parent: 'sec-1', status: 'needsAction' },
        ],
      },
    });

    const result = await sync(AUTH, FILE, deps);
    assert.equal(result.created, 1); // remote task is new
    const output = getWritten();
    assert.ok(output.includes('Remote task'));
    assert.ok(output.includes('Local task'));
  });

  it('local deletion — triggers deleteTask', async () => {
    const deleted = [];
    const { deps } = makeDeps({
      existsSync: () => true,
      readFile: async () => '## Work\n\n',
      loadMapping: async () => ({
        file: FILE,
        lastSync: null,
        taskListId: 'list-1',
        sections: {
          Work: {
            taskId: 'sec-1',
            items: { 'Old task': { taskId: 't1', hash: 'abcd1234', status: 'needsAction' } },
          },
        },
      }),
      api: {
        getTasks: async () => [
          { id: 'sec-1', title: 'Work', status: 'needsAction' },
          { id: 't1', title: 'Old task', parent: 'sec-1', status: 'needsAction' },
        ],
        deleteTask: async (_auth, _listId, taskId) => { deleted.push(taskId); },
      },
    });

    const result = await sync(AUTH, FILE, deps);
    assert.ok(deleted.includes('t1'));
    assert.equal(result.deleted, 1);
  });

  it('remote deletion — removed from output', async () => {
    const { deps, getWritten } = makeDeps({
      existsSync: () => true,
      readFile: async () => '## Work\n\n- [ ] Keep this\n- [ ] Gone remotely\n',
      loadMapping: async () => ({
        file: FILE,
        lastSync: null,
        taskListId: 'list-1',
        sections: {
          Work: {
            taskId: 'sec-1',
            items: {
              'Keep this': { taskId: 't1', hash: itemHash('Keep this', false, null, null), status: 'needsAction' },
              'Gone remotely': { taskId: 't2', hash: 'abcd1234', status: 'needsAction' },
            },
          },
        },
      }),
      api: {
        getTasks: async () => [
          { id: 'sec-1', title: 'Work', status: 'needsAction' },
          { id: 't1', title: 'Keep this', parent: 'sec-1', status: 'needsAction' },
          // t2 "Gone remotely" is NOT in remote — deleted remotely
        ],
      },
    });

    await sync(AUTH, FILE, deps);
    const output = getWritten();
    assert.ok(output.includes('Keep this'));
    assert.ok(!output.includes('Gone remotely'));
  });

  it('local completion — triggers updateTask with completed', async () => {
    const updates = [];
    const { deps } = makeDeps({
      existsSync: () => true,
      readFile: async () => '## Work\n\n- [x] Done task\n',
      loadMapping: async () => ({
        file: FILE,
        lastSync: null,
        taskListId: 'list-1',
        sections: {
          Work: {
            taskId: 'sec-1',
            items: {
              'Done task': { taskId: 't1', hash: itemHash('Done task', false, null, null), status: 'needsAction' },
            },
          },
        },
      }),
      api: {
        getTasks: async () => [
          { id: 'sec-1', title: 'Work', status: 'needsAction' },
          { id: 't1', title: 'Done task', parent: 'sec-1', status: 'needsAction' },
        ],
        updateTask: async (_auth, _listId, taskId, body) => { updates.push({ taskId, ...body }); },
      },
    });

    await sync(AUTH, FILE, deps);
    assert.ok(updates.some((u) => u.taskId === 't1' && u.status === 'completed'));
  });

  it('remote completion with delete config — deleted from both', async () => {
    const { deps, getWritten } = makeDeps({
      existsSync: () => true,
      readFile: async () => '<!-- todo-tasks completed: delete -->\n## Work\n\n- [ ] Active\n',
      loadMapping: async () => ({
        file: FILE,
        lastSync: null,
        taskListId: 'list-1',
        sections: {
          Work: {
            taskId: 'sec-1',
            items: {
              Active: { taskId: 't1', hash: itemHash('Active', false, null, null), status: 'needsAction' },
              Finished: { taskId: 't2', hash: 'abcd1234', status: 'needsAction' },
            },
          },
        },
      }),
      api: {
        getTasks: async () => [
          { id: 'sec-1', title: 'Work', status: 'needsAction' },
          { id: 't1', title: 'Active', parent: 'sec-1', status: 'needsAction' },
          { id: 't2', title: 'Finished', parent: 'sec-1', status: 'completed' },
        ],
      },
    });

    const result = await sync(AUTH, FILE, deps);
    assert.equal(result.deleted, 1);
    const output = getWritten();
    assert.ok(!output.includes('Finished'));
  });

  it('hash change — triggers update', async () => {
    const updates = [];
    const { deps } = makeDeps({
      existsSync: () => true,
      readFile: async () => '## Work\n\n- [ ] Task (date: 2026-04-01)\n',
      loadMapping: async () => ({
        file: FILE,
        lastSync: null,
        taskListId: 'list-1',
        sections: {
          Work: {
            taskId: 'sec-1',
            items: {
              Task: { taskId: 't1', hash: 'old-hash', status: 'needsAction' },
            },
          },
        },
      }),
      api: {
        getTasks: async () => [
          { id: 'sec-1', title: 'Work', status: 'needsAction' },
          { id: 't1', title: 'Task', parent: 'sec-1', status: 'needsAction' },
        ],
        updateTask: async (_auth, _listId, taskId, body) => {
          updates.push({ taskId, ...body });
          return {};
        },
      },
    });

    const result = await sync(AUTH, FILE, deps);
    assert.equal(result.updated, 1);
    assert.ok(updates.some((u) => u.taskId === 't1'));
  });

  it('safety check — non-empty file with empty result throws', async () => {
    const { deps } = makeDeps({
      existsSync: () => true,
      readFile: async () => '## Work\n\n- [ ] Task\n',
      loadMapping: async () => ({
        file: FILE,
        lastSync: null,
        taskListId: 'list-1',
        sections: {
          Work: { taskId: 'sec-1', items: { Task: { taskId: 't1', hash: 'x', status: 'needsAction' } } },
        },
      }),
      api: {
        // Remote has no tasks at all — everything looks deleted
        getTasks: async () => [],
      },
    });

    await assert.rejects(() => sync(AUTH, FILE, deps), {
      message: /empty result.*non-empty/i,
    });
  });

  it('404 recovery — recreates task list', async () => {
    let callCount = 0;
    const { deps } = makeDeps({
      existsSync: () => false,
      loadMapping: async () => ({
        file: FILE,
        lastSync: null,
        taskListId: 'old-list',
        sections: {},
      }),
      api: {
        getTasks: async () => {
          callCount++;
          if (callCount === 1) {
            const err = new Error('Not Found');
            err.code = 404;
            throw err;
          }
          return [];
        },
        createTaskList: async (_auth, title) => ({ id: 'new-list', title }),
      },
    });

    const result = await sync(AUTH, FILE, deps);
    assert.equal(result.sections, 0);
    assert.equal(callCount, 2); // first 404, then success
  });

  it('fuzzy rename — updates remote, not delete+create', async () => {
    const updates = [];
    const deleted = [];
    const created = [];
    const { deps } = makeDeps({
      existsSync: () => true,
      readFile: async () => '## Work\n\n- [ ] Set up CI pipeline\n',
      loadMapping: async () => ({
        file: FILE,
        lastSync: null,
        taskListId: 'list-1',
        sections: {},
      }),
      api: {
        getTasks: async () => [
          { id: 'sec-1', title: 'Work', status: 'needsAction' },
          { id: 't1', title: 'Setup CI pipeline', parent: 'sec-1', status: 'needsAction' },
        ],
        updateTask: async (_auth, _listId, taskId, body) => {
          updates.push({ taskId, ...body });
          return {};
        },
        deleteTask: async (_auth, _listId, taskId) => { deleted.push(taskId); },
        createTask: async (_auth, _listId, body) => {
          const task = { id: `new-${created.length}`, ...body };
          created.push(task);
          return task;
        },
      },
    });

    await sync(AUTH, FILE, deps);
    // Should update the existing task, not delete+create
    assert.ok(updates.some((u) => u.taskId === 't1' && u.title === 'Set up CI pipeline'));
    assert.ok(!deleted.includes('t1'));
  });
});
