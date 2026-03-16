import { readFile as _readFile, writeFile as _writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { existsSync as _existsSync } from 'node:fs';
import { parse } from './parser.js';
import { format } from './formatter.js';
import { loadMapping as _loadMapping, saveMapping as _saveMapping, itemHash } from './mapping.js';
import * as _api from './tasks-api.js';
import { fuzzyMatch } from './fuzzy.js';

/**
 * Derives a project name from the file path.
 * If file is in a docs/ folder, uses the grandparent (project root).
 */
function projectName(filePath) {
  const dir = dirname(filePath);
  const parent = basename(dir);
  if (parent.toLowerCase() === 'docs') {
    return basename(dirname(dir));
  }
  return parent;
}

function isNotFound(err) {
  return err?.code === 404 || err?.response?.status === 404 || err?.status === 404;
}

/**
 * Fetches remote state from Google Tasks and returns structured sections.
 * Also returns the raw parent→children map for ID lookups.
 */
async function fetchRemote(api, auth, taskListId) {
  const tasks = await api.getTasks(auth, taskListId);

  const children = new Map();
  const topLevel = [];
  for (const task of tasks) {
    if (task.parent) {
      if (!children.has(task.parent)) children.set(task.parent, []);
      children.get(task.parent).push(task);
    } else {
      topLevel.push(task);
    }
  }

  return { topLevel, children };
}

/** Default dependencies — real implementations. */
const defaultDeps = {
  api: _api,
  loadMapping: _loadMapping,
  saveMapping: _saveMapping,
  readFile: _readFile,
  writeFile: _writeFile,
  existsSync: _existsSync,
};

/**
 * Sync: Two-way sync between TODO.md and Google Tasks.
 *
 * Uses the mapping as "last known state" to determine what changed where:
 * - In TODO.md but not mapping → new locally → create in Google Tasks
 * - In Google Tasks but not mapping → new remotely → add to TODO.md
 * - In mapping but not TODO.md → deleted locally → delete from Google Tasks
 * - In mapping but not Google Tasks → deleted remotely → remove from TODO.md
 * - Completed (either side) → delete from both
 */
export async function sync(auth, filePath, deps = {}) {
  const { api, loadMapping, saveMapping, readFile, writeFile, existsSync } = { ...defaultDeps, ...deps };

  const mapping = await loadMapping(filePath);

  // Read local TODO.md (empty if file doesn't exist yet)
  let localSections = [];
  let config = {};
  if (existsSync(filePath)) {
    const content = await readFile(filePath, 'utf-8');
    const parsed = parse(content);
    localSections = parsed.sections;
    config = parsed.config;
  }

  // Ensure we have a task list
  const listName = config.list || projectName(filePath);
  if (!mapping.taskListId) {
    const taskList = await api.createTaskList(auth, listName);
    mapping.taskListId = taskList.id;
  }
  if (!mapping.sections) mapping.sections = {};

  // Fetch remote state — if task list was deleted, reset and create a new one
  let topLevel, children;
  try {
    ({ topLevel, children } = await fetchRemote(api, auth, mapping.taskListId));
  } catch (err) {
    if (!isNotFound(err)) throw err;
    const taskList = await api.createTaskList(auth, listName);
    mapping.taskListId = taskList.id;
    mapping.sections = {};
    ({ topLevel, children } = await fetchRemote(api, auth, mapping.taskListId));
  }

  // Build lookup maps
  const localByHeading = new Map(localSections.map((s) => [s.heading, s]));
  const remoteByTitle = new Map(topLevel.map((t) => [t.title, t]));
  const mappedHeadings = new Set(Object.keys(mapping.sections));

  // Fuzzy-match renamed sections before collecting all headings
  const unmatchedLocalHeadings = [...localByHeading.keys()].filter(
    (h) => !remoteByTitle.has(h) && !mappedHeadings.has(h),
  );
  const unmatchedRemoteHeadings = [...remoteByTitle.keys()].filter(
    (h) => !localByHeading.has(h) && !mappedHeadings.has(h),
  );
  for (const { local, remote } of fuzzyMatch(unmatchedLocalHeadings, unmatchedRemoteHeadings)) {
    // Treat local as canonical — update remote title and remap
    const remoteTask = remoteByTitle.get(remote);
    try {
      await api.updateTask(auth, mapping.taskListId, remoteTask.id, { title: local });
    } catch (err) {
      if (!isNotFound(err)) throw err;
      // Stale ID — skip remap, will be treated as new local task
      remoteByTitle.delete(remote);
      delete mapping.sections[remote];
      mappedHeadings.delete(remote);
      continue;
    }
    remoteByTitle.delete(remote);
    remoteByTitle.set(local, { ...remoteTask, title: local });
    if (mapping.sections[remote]) {
      mapping.sections[local] = mapping.sections[remote];
      delete mapping.sections[remote];
      mappedHeadings.delete(remote);
      mappedHeadings.add(local);
    }
  }

  // Collect all heading names from all three sources
  const allHeadings = new Set([
    ...localByHeading.keys(),
    ...remoteByTitle.keys(),
    ...mappedHeadings,
  ]);

  const resultSections = [];
  const stats = { created: 0, deleted: 0, updated: 0 };

  for (const heading of allHeadings) {
    const local = localByHeading.get(heading);
    const remote = remoteByTitle.get(heading);
    const mapped = mapping.sections[heading];

    // --- Section-level logic ---

    // Completed remotely
    if (remote && remote.status === 'completed') {
      if (config.completed === 'delete') {
        delete mapping.sections[heading];
        stats.deleted++;
        continue;
      }
      // Keep: section still appears in result (items handled below)
    }

    // In mapping but not local → deleted locally → delete from Google Tasks
    if (!local && mapped) {
      if (remote) {
        const deleteOps = (children.get(remote.id) || []).map(
          (child) => api.deleteTask(auth, mapping.taskListId, child.id).catch((err) => { if (!isNotFound(err)) throw err; }),
        );
        await Promise.all(deleteOps);
        try { await api.deleteTask(auth, mapping.taskListId, remote.id); } catch (err) { if (!isNotFound(err)) throw err; }
      }
      delete mapping.sections[heading];
      stats.deleted++;
      continue;
    }

    // In mapping but not remote → deleted remotely → skip (don't add to result)
    if (!remote && mapped) {
      delete mapping.sections[heading];
      continue;
    }

    // Ensure section exists in Google Tasks
    let secMapping = mapped || null;
    let remoteParentId = remote ? remote.id : null;

    if (!remoteParentId) {
      // New locally → create in Google Tasks
      const parentTask = await api.createTask(auth, mapping.taskListId, {
        title: heading,
        status: 'needsAction',
      });
      remoteParentId = parentTask.id;
      secMapping = { taskId: parentTask.id, items: {} };
      mapping.sections[heading] = secMapping;
      stats.created++;
    } else if (!secMapping) {
      // New remotely → add to mapping
      secMapping = { taskId: remoteParentId, items: {} };
      mapping.sections[heading] = secMapping;
    } else {
      secMapping.taskId = remoteParentId;
    }

    // --- Item-level logic ---
    const localItems = new Map((local ? local.items : []).map((i) => [i.text, i]));
    const remoteChildren = children.get(remoteParentId) || [];
    const remoteItems = new Map(remoteChildren.map((t) => [t.title, t]));
    const mappedItems = new Set(Object.keys(secMapping.items || {}));

    // Fuzzy-match renamed items before collecting all items
    const unmatchedLocalItems = [...localItems.keys()].filter(
      (t) => !remoteItems.has(t) && !mappedItems.has(t),
    );
    const unmatchedRemoteItems = [...remoteItems.keys()].filter(
      (t) => !localItems.has(t) && !mappedItems.has(t),
    );
    for (const { local: localText, remote: remoteText } of fuzzyMatch(unmatchedLocalItems, unmatchedRemoteItems)) {
      const remoteTask = remoteItems.get(remoteText);
      try {
        await api.updateTask(auth, mapping.taskListId, remoteTask.id, {
          title: localText,
          status: remoteTask.status,
          due: localItems.get(localText)?.due,
        });
      } catch (err) {
        if (!isNotFound(err)) throw err;
        remoteItems.delete(remoteText);
        delete secMapping.items[remoteText];
        mappedItems.delete(remoteText);
        continue;
      }
      remoteItems.delete(remoteText);
      remoteItems.set(localText, { ...remoteTask, title: localText });
      if (secMapping.items[remoteText]) {
        secMapping.items[localText] = secMapping.items[remoteText];
        delete secMapping.items[remoteText];
        mappedItems.delete(remoteText);
        mappedItems.add(localText);
      }
    }

    const allItems = new Set([
      ...localItems.keys(),
      ...remoteItems.keys(),
      ...mappedItems,
    ]);

    // --- Classify items into buckets ---
    const resultItems = [];
    const toDelete = [];
    const toCreate = [];
    const toComplete = [];
    const toUpdate = [];
    const toAddResult = [];

    for (const text of allItems) {
      const localItem = localItems.get(text);
      const remoteItem = remoteItems.get(text);
      const mappedItem = secMapping.items[text];

      const deleteCompleted = config.completed === 'delete';

      // Completed remotely
      if (remoteItem && remoteItem.status === 'completed') {
        if (deleteCompleted) {
          delete secMapping.items[text];
          stats.deleted++;
          continue;
        }
        resultItems.push({
          text,
          completed: true,
          due: remoteItem.due || localItem?.due || null,
          notes: remoteItem.notes || localItem?.notes || null,
        });
        continue;
      }

      // Completed locally → mark as completed remotely
      if (localItem && localItem.completed) {
        if (remoteItem) {
          toComplete.push({ remoteItem, text });
        }
        if (deleteCompleted) {
          delete secMapping.items[text];
          stats.deleted++;
          continue;
        }
        resultItems.push({
          text,
          completed: true,
          due: remoteItem?.due || localItem.due || null,
          notes: localItem.notes || remoteItem?.notes || null,
        });
        continue;
      }

      // In mapping but not local → deleted locally → delete remote
      if (!localItem && mappedItem) {
        if (remoteItem) {
          toDelete.push({ remoteItem, text });
        }
        delete secMapping.items[text];
        stats.deleted++;
        continue;
      }

      // In mapping but not remote → deleted remotely → skip
      if (!remoteItem && mappedItem) {
        delete secMapping.items[text];
        continue;
      }

      // New locally → create in Google Tasks
      if (localItem && !remoteItem && !mappedItem) {
        toCreate.push({ localItem, text, remoteParentId });
      }

      // New remotely → just add to mapping
      if (remoteItem && !localItem && !mappedItem) {
        secMapping.items[text] = {
          taskId: remoteItem.id,
          hash: itemHash(text, false, remoteItem.notes, remoteItem.due),
          status: remoteItem.status,
        };
        stats.created++;
      }

      // Exists on both → check for updates
      if (localItem && remoteItem && mappedItem) {
        const notes = localItem.notes || remoteItem.notes || null;
        const due = remoteItem.due || localItem.due || null;
        const hash = itemHash(text, false, notes, due);
        if (mappedItem.hash !== hash) {
          toUpdate.push({ localItem, remoteItem, text, notes, due, hash, mappedItem, remoteParentId });
        }
      }

      toAddResult.push({ text, remoteItem, localItem });
    }

    // --- Execute batched API calls ---
    await Promise.all(toDelete.map(
      ({ remoteItem }) => api.deleteTask(auth, mapping.taskListId, remoteItem.id).catch((err) => { if (!isNotFound(err)) throw err; }),
    ));

    await Promise.all(toComplete.map(
      ({ remoteItem }) => api.updateTask(auth, mapping.taskListId, remoteItem.id, { status: 'completed' }).catch((err) => { if (!isNotFound(err)) throw err; }),
    ));

    // Creates are sequential — they depend on parent ID and ordering
    for (const { localItem, text, remoteParentId: parentId } of toCreate) {
      const task = await api.createTask(auth, mapping.taskListId, {
        title: text,
        status: 'needsAction',
        due: localItem.due,
        notes: localItem.notes,
        parent: parentId,
      });
      secMapping.items[text] = {
        taskId: task.id,
        hash: itemHash(text, false, localItem.notes, localItem.due),
        status: 'needsAction',
      };
      stats.created++;
    }

    await Promise.all(toUpdate.map(async ({ localItem, remoteItem, text, notes, due, hash, mappedItem, remoteParentId: parentId }) => {
      try {
        await api.updateTask(auth, mapping.taskListId, remoteItem.id, {
          title: text,
          status: 'needsAction',
          due,
          notes: notes || undefined,
        });
        mappedItem.hash = hash;
        stats.updated++;
      } catch (err) {
        if (!isNotFound(err)) throw err;
        // Stale ID — recreate as new task
        const task = await api.createTask(auth, mapping.taskListId, {
          title: text,
          status: 'needsAction',
          due: localItem.due,
          notes: localItem.notes,
          parent: parentId,
        });
        secMapping.items[text] = {
          taskId: task.id,
          hash: itemHash(text, false, localItem.notes, localItem.due),
          status: 'needsAction',
        };
        stats.created++;
      }
    }));

    for (const { text, remoteItem, localItem } of toAddResult) {
      resultItems.push({
        text,
        completed: false,
        due: remoteItem?.due || localItem?.due || null,
        notes: remoteItem?.notes || localItem?.notes || null,
      });
    }

    resultSections.push({
      heading,
      level: local?.level || 2,
      items: resultItems,
    });
  }

  // Clear completed tasks from Google Tasks (only in delete mode)
  if (stats.deleted > 0 && config.completed === 'delete') {
    try { await api.clearCompleted(auth, mapping.taskListId); } catch (err) { if (!isNotFound(err)) throw err; }
  }

  // Safety check: don't wipe a non-empty file with empty results
  if (resultSections.length === 0 && localSections.length > 0) {
    throw new Error('Sync produced empty result from non-empty TODO.md — aborting to prevent data loss.');
  }

  // Write updated TODO.md
  await writeFile(filePath, format(resultSections, config));
  await saveMapping(filePath, mapping);

  const totalItems = resultSections.reduce((n, s) => n + s.items.length, 0);
  return { sections: resultSections.length, items: totalItems, ...stats };
}
