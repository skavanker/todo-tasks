import { readFile, writeFile } from 'node:fs/promises';
import { basename, dirname } from 'node:path';
import { existsSync } from 'node:fs';
import { parse } from './parser.js';
import { format } from './formatter.js';
import { loadMapping, saveMapping, itemHash } from './mapping.js';
import * as api from './tasks-api.js';
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
async function fetchRemote(auth, taskListId) {
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
export async function sync(auth, filePath) {
  const mapping = await loadMapping(filePath);

  // Read local TODO.md (empty if file doesn't exist yet)
  let localSections = [];
  if (existsSync(filePath)) {
    const content = await readFile(filePath, 'utf-8');
    localSections = parse(content);
  }

  // Ensure we have a task list
  if (!mapping.taskListId) {
    const taskList = await api.createTaskList(auth, projectName(filePath));
    mapping.taskListId = taskList.id;
  }
  if (!mapping.sections) mapping.sections = {};

  // Fetch remote state — if task list was deleted, reset and create a new one
  let topLevel, children;
  try {
    ({ topLevel, children } = await fetchRemote(auth, mapping.taskListId));
  } catch (err) {
    if (!isNotFound(err)) throw err;
    const taskList = await api.createTaskList(auth, projectName(filePath));
    mapping.taskListId = taskList.id;
    mapping.sections = {};
    ({ topLevel, children } = await fetchRemote(auth, mapping.taskListId));
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

    // Completed remotely → remove from mapping (cleared in bulk later)
    if (remote && remote.status === 'completed') {
      delete mapping.sections[heading];
      stats.deleted++;
      continue;
    }

    // In mapping but not local → deleted locally → delete from Google Tasks
    if (!local && mapped) {
      if (remote) {
        // Delete children first
        for (const child of (children.get(remote.id) || [])) {
          try { await api.deleteTask(auth, mapping.taskListId, child.id); } catch {}
        }
        try { await api.deleteTask(auth, mapping.taskListId, remote.id); } catch {}
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

    const resultItems = [];

    for (const text of allItems) {
      const localItem = localItems.get(text);
      const remoteItem = remoteItems.get(text);
      const mappedItem = secMapping.items[text];

      // Completed remotely → remove from mapping (cleared in bulk later)
      if (remoteItem && remoteItem.status === 'completed') {
        delete secMapping.items[text];
        stats.deleted++;
        continue;
      }

      // Completed locally → mark as completed remotely (cleared in bulk later)
      if (localItem && localItem.completed) {
        if (remoteItem) {
          try {
            await api.updateTask(auth, mapping.taskListId, remoteItem.id, {
              status: 'completed',
            });
          } catch {}
        }
        delete secMapping.items[text];
        stats.deleted++;
        continue;
      }

      // In mapping but not local → deleted locally → delete remote
      if (!localItem && mappedItem) {
        if (remoteItem) {
          try { await api.deleteTask(auth, mapping.taskListId, remoteItem.id); } catch {}
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
        const task = await api.createTask(auth, mapping.taskListId, {
          title: text,
          status: 'needsAction',
          due: localItem.due,
          parent: remoteParentId,
        });
        secMapping.items[text] = {
          taskId: task.id,
          hash: itemHash(text, false),
          status: 'needsAction',
        };
        stats.created++;
      }

      // New remotely → just add to mapping
      if (remoteItem && !localItem && !mappedItem) {
        secMapping.items[text] = {
          taskId: remoteItem.id,
          hash: itemHash(text, false),
          status: remoteItem.status,
        };
        stats.created++;
      }

      // Exists on both → check for updates
      if (localItem && remoteItem && mappedItem) {
        const hash = itemHash(text, false);
        if (mappedItem.hash !== hash) {
          try {
            await api.updateTask(auth, mapping.taskListId, remoteItem.id, {
              title: text,
              status: 'needsAction',
              due: remoteItem.due,
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
              parent: remoteParentId,
            });
            secMapping.items[text] = {
              taskId: task.id,
              hash: itemHash(text, false),
              status: 'needsAction',
            };
            stats.created++;
          }
        }
      }

      resultItems.push({
        text,
        completed: false,
        due: remoteItem?.due || localItem?.due || null,
      });
    }

    resultSections.push({
      heading,
      level: local?.level || 2,
      items: resultItems,
    });
  }

  // Clear all completed tasks in one API call
  if (stats.deleted > 0) {
    try { await api.clearCompleted(auth, mapping.taskListId); } catch {}
  }

  // Safety check: don't wipe a non-empty file with empty results
  if (resultSections.length === 0 && localSections.length > 0) {
    throw new Error('Sync produced empty result from non-empty TODO.md — aborting to prevent data loss.');
  }

  // Write updated TODO.md
  await writeFile(filePath, format(resultSections));
  await saveMapping(filePath, mapping);

  const totalItems = resultSections.reduce((n, s) => n + s.items.length, 0);
  return { sections: resultSections.length, items: totalItems, ...stats };
}
