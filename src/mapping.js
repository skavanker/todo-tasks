import { readFile, writeFile, mkdir, chmod } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

const MAPPINGS_DIR = join(homedir(), '.todo-tasks', 'mappings');

/**
 * Generates a stable hash for a project based on the absolute path to TODO.md.
 */
function projectHash(filePath) {
  const absolute = resolve(filePath);
  return createHash('sha256').update(absolute).digest('hex').slice(0, 12);
}

function mappingPath(filePath) {
  return join(MAPPINGS_DIR, `${projectHash(filePath)}.json`);
}

/**
 * Loads the mapping for a given TODO.md file.
 * Returns a default empty mapping if none exists.
 */
export async function loadMapping(filePath) {
  try {
    const content = await readFile(mappingPath(filePath), 'utf-8');
    return JSON.parse(content);
  } catch {
    return {
      file: resolve(filePath),
      lastSync: null,
      sections: {},
    };
  }
}

/**
 * Saves the mapping for a given TODO.md file.
 */
export async function saveMapping(filePath, mapping) {
  await mkdir(MAPPINGS_DIR, { recursive: true, mode: 0o700 });
  mapping.lastSync = new Date().toISOString();
  const path = mappingPath(filePath);
  await writeFile(path, JSON.stringify(mapping, null, 2));
  await chmod(path, 0o600);
}

/**
 * Computes a hash for a task item (text + completed status).
 * Used to detect changes since last sync.
 */
export function itemHash(text, completed, notes, due) {
  return createHash('sha256')
    .update(`${text}:${completed}:${notes || ''}:${due || ''}`)
    .digest('hex')
    .slice(0, 8);
}
