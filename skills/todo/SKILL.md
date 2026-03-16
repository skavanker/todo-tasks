---
name: todo
description: Manage Google Tasks — add tasks, sync TODO.md, list tasks, or publish the package.
argument-hint: <action or task description> [in <list name>]
allowed-tools: Bash(todo-tasks *), Bash(npm *), Bash(node *), Read, Edit
---

Parse the user's input from `$ARGUMENTS` and determine the action:

**Add a task** (default — any text that isn't a known command):
- The task description is everything before "in <list name>"
- The list name comes after "in" at the end
- If no list is specified, ask which list to use
- Run: `todo-tasks add "<task description>" --list "<list name>"`

**sync** — Two-way sync TODO.md with Google Tasks:
- Run: `todo-tasks sync`

**lists** — Show all Google Tasks lists:
- Run: `todo-tasks lists`

**create list <name>** — Create a new Google Tasks list:
- Run: `todo-tasks create-list "<name>"`

**publish** — Bump version, test, and publish to npm:
1. Bump the patch version in package.json
2. Run `npm test` — abort if tests fail
3. Run `npm publish --access public`
4. Run `npm i -g @skavanker/todo-tasks`
5. Verify with `npm list -g @skavanker/todo-tasks`

After any action, confirm what was done.
