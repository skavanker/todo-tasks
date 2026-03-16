#!/usr/bin/env node

import { Command } from 'commander';
import { existsSync } from 'node:fs';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve, join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { authorize, getAuthClient } from '../src/auth.js';
import { sync } from '../src/sync.js';
import * as api from '../src/tasks-api.js';

const require = createRequire(import.meta.url);
const { version } = require('../package.json');

const program = new Command();

program
  .name('todo-tasks')
  .description('Sync TODO.md files with Google Tasks')
  .version(version);

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

program
  .command('create-list')
  .description('Create a new Google Tasks list')
  .argument('<name>', 'List name')
  .action(async (name) => {
    try {
      const auth = await getAuthClient();
      const list = await api.createTaskList(auth, name);
      console.log(`Created list: "${list.title}"`);
    } catch (err) {
      console.error('Failed:', err.message);
      process.exit(1);
    }
  });

const setup = program
  .command('setup')
  .description('Set up integrations with AI tools');

setup
  .command('claude')
  .description('Install Claude Code skills for todo-tasks')
  .action(async () => {
    try {
      const pkgDir = dirname(dirname(fileURLToPath(import.meta.url)));
      const skillsSource = join(pkgDir, 'skills');
      const skillsDest = join(homedir(), '.claude', 'skills');

      const skills = await readdir(skillsSource);
      for (const skill of skills) {
        const srcDir = join(skillsSource, skill);
        const destDir = join(skillsDest, skill);
        await mkdir(destDir, { recursive: true });

        const files = await readdir(srcDir);
        for (const file of files) {
          const content = await readFile(join(srcDir, file), 'utf-8');
          await writeFile(join(destDir, file), content);
        }
        console.log(`Installed skill: /${skill}`);
      }
      console.log('\nDone! Skills are available in Claude Code.');
    } catch (err) {
      console.error('Setup failed:', err.message);
      process.exit(1);
    }
  });

program.parse();
