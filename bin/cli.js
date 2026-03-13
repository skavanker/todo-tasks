#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { authorize, getAuthClient } from '../src/auth.js';
import { sync } from '../src/sync.js';
import * as api from '../src/tasks-api.js';

const program = new Command();

program
  .name('todo-tasks')
  .description('Sync TODO.md files with Google Tasks')
  .version('0.1.0');

/**
 * Finds the TODO.md file using discovery order:
 * 1. --file flag  2. docs/TODO.md  3. TODO.md  4. error
 */
function findTodoFile(options) {
  if (options.file) {
    const p = resolve(options.file);
    if (!existsSync(p)) {
      console.error(`File not found: ${p}`);
      process.exit(1);
    }
    return p;
  }

  const candidates = ['docs/TODO.md', 'TODO.md'];
  for (const c of candidates) {
    const p = resolve(c);
    if (existsSync(p)) return p;
  }

  console.error('No TODO.md found. Use --file to specify the path.');
  process.exit(1);
}

program
  .command('auth')
  .description('Set up Google Tasks connection (OAuth2)')
  .action(async () => {
    try {
      await authorize();
    } catch (err) {
      console.error('Auth failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('sync')
  .description('Two-way sync between TODO.md and Google Tasks')
  .option('-f, --file <path>', 'Path to TODO.md')
  .action(async (options) => {
    try {
      const filePath = findTodoFile(options);
      const auth = await getAuthClient();
      console.log(`Syncing ${filePath} with Google Tasks...`);
      const result = await sync(auth, filePath);
      console.log(
        `Done! ${result.sections} sections, ${result.items} tasks` +
        ` (${result.created} created, ${result.updated} updated, ${result.deleted} deleted)`
      );
    } catch (err) {
      console.error('Sync failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('add')
  .description('Add a task directly to Google Tasks')
  .argument('<title>', 'Task title')
  .requiredOption('-l, --list <name>', 'Task list name (partial match)')
  .action(async (title, options) => {
    try {
      const auth = await getAuthClient();
      const lists = await api.getTaskLists(auth);
      const target = lists.find(l => l.title.toLowerCase().includes(options.list.toLowerCase()));

      if (!target) {
        console.error(`List "${options.list}" not found. Available: ${lists.map(l => l.title).join(', ')}`);
        process.exit(1);
      }

      const task = await api.createTask(auth, target.id, {
        title,
        status: 'needsAction',
      });
      console.log(`Created: "${task.title}" in ${target.title}`);
    } catch (err) {
      console.error('Add failed:', err.message);
      process.exit(1);
    }
  });

program
  .command('lists')
  .description('Show all Google Tasks lists')
  .action(async () => {
    try {
      const auth = await getAuthClient();
      const lists = await api.getTaskLists(auth);
      for (const list of lists) {
        console.log(`- ${list.title}`);
      }
    } catch (err) {
      console.error('Failed:', err.message);
      process.exit(1);
    }
  });

program.parse();
