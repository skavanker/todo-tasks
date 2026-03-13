# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**todo-tasks** — CLI tool that syncs `TODO.md` files with Google Tasks.

## Commands

```bash
npm install              # Install dependencies
npm test                 # Run tests (node --test)
node bin/cli.js auth     # OAuth2 setup (opens browser)
node bin/cli.js sync     # Two-way sync TODO.md ↔ Google Tasks
```

When published: `npm i -g todo-tasks` → commands become `todo-tasks auth|sync`.

## Architecture

The data flow is: **Markdown ↔ Structured data ↔ Google Tasks API**, with a mapping layer for two-way sync.

```
bin/cli.js          → CLI entry (commander), routes to sync/auth
src/parser.js       → Markdown → structured data (headings, checkboxes, dates)
src/formatter.js    → Structured data → Markdown
src/tasks-api.js    → Google Tasks API v1 wrapper (googleapis)
src/sync.js         → Two-way sync logic, diffs local + remote against mapping
src/mapping.js      → Read/write per-project mapping files (~/.todo-tasks/mappings/<hash>.json)
src/auth.js         → OAuth2 flow + token management (~/.todo-tasks/token.json)
```

### Markdown ↔ Google Tasks mapping

One task list per project (named after folder). Headings become parent tasks, items become subtasks.

| Markdown | Google Tasks |
|----------|-------------|
| `# / ## Heading` | Parent task (section) |
| `- [ ] Task` | Subtask (needsAction) |
| `- [x] Task` | Completed → deleted from both sides |
| `(date: 03-15)` or `(date: 2027-03-15)` | Due date |

Date without year defaults to current year. Date metadata is stripped from task title before sending to API.

### Two-way sync via mapping files

Each project gets a mapping file at `~/.todo-tasks/mappings/<hash>.json` (hash of absolute path to TODO.md). The mapping is the "last known state" used to determine what changed where:

- In TODO.md but not mapping → new locally → create in Google Tasks
- In Google Tasks but not mapping → new remotely → add to TODO.md
- In mapping but not TODO.md → deleted locally → delete from Google Tasks
- In mapping but not Google Tasks → deleted remotely → remove from TODO.md
- Completed (either side) → delete from both

### TODO file discovery order

1. `--file` flag  2. `docs/TODO.md`  3. `TODO.md`  4. Error

## Conventions

- Pure ESM (`"type": "module"`)
- Minimal dependencies: `googleapis` + `commander` + `open`
- Tests use Node.js built-in test runner (`node --test`)
- Google Cloud credentials: user must place `credentials.json` in `~/.todo-tasks/`

## Known API limitations

- Google Tasks API does not expose star/priority status
- Google Tasks API has only one `due` field (the UI shows "date" and "due date" but the API only returns `due`)
- Task matching is text-based — editing a task title on either side looks like a delete + create
