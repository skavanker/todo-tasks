# todo-tasks

CLI tool that syncs `TODO.md` files with Google Tasks.

## How it works

Your markdown TODO file maps directly to Google Tasks:

| Markdown | Google Tasks |
|----------|-------------|
| `## Heading` | Task list section |
| `- [ ] Task` | Task |
| `- [x] Task` | Completed (kept by default) |
| Indented text under task | Task notes/description |
| `(date: 03-15)` | Due date (current year) |
| `(date: 2027-03-15)` | Due date (explicit year) |

One task list is created per project. Headings become sections, and checkbox items become tasks. The parser handles `*`, `+`, and `-` list markers, `[X]` (uppercase), indented items, and files with no headings.

### Fuzzy matching

Task identity is based on text matching, not position. If you rename a task slightly (e.g. "Setup CI" → "Set up CI"), the sync detects it as a rename rather than a delete + create. Completely rewritten tasks are treated as delete + create — both versions appear and you mark the wrong one as done.

### Date handling

Due dates are managed in Google Tasks. When you set a date in Google Tasks, it syncs to your markdown. Dates in markdown are preserved but remote dates take priority.

## Install

```bash
npm install -g @skavanker/todo-tasks
```

## Setup

You need your own Google Cloud credentials to use todo-tasks.

### 1. Create a Google Cloud project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project (or select an existing one)
3. Enable the **Google Tasks API** — APIs & Services → Library → search "Tasks API" → Enable

### 2. Configure OAuth consent screen

1. Go to APIs & Services → OAuth consent screen
2. Select **External** and click Create
3. Fill in the required fields (app name, user support email, developer email)
4. On the **Scopes** page, add `https://www.googleapis.com/auth/tasks`
5. On the **Test users** page, add your Google email address

### 3. Create credentials

1. Go to APIs & Services → Credentials → Create Credentials → **OAuth client ID**
2. Select **Desktop app** as the application type
3. Download the JSON file
4. Place it in your config directory:
   ```bash
   mkdir -p ~/.todo-tasks
   mv ~/Downloads/client_secret_*.json ~/.todo-tasks/credentials.json
   ```

### 4. Authenticate

```bash
todo-tasks auth
```

This opens your browser for Google sign-in. After approving, your token is saved locally at `~/.todo-tasks/token.json`.

## Usage

```bash
# Two-way sync between TODO.md and Google Tasks
todo-tasks sync

# Specify a different file
todo-tasks sync --file path/to/TODO.md

# Add a task to a Google Tasks list
todo-tasks add "Buy groceries" --list "Home"

# Show all your Google Tasks lists
todo-tasks lists

# Create a new Google Tasks list
todo-tasks create-list "Shopping"
```

By default, the tool looks for `docs/TODO.md` then `TODO.md` in the current directory.

## Claude Code integration

If you use [Claude Code](https://claude.ai/code), you can install a `/todo` skill:

```bash
todo-tasks setup claude
```

This gives you quick commands like:
- `/todo buy milk in Home` — add a task
- `/todo sync` — sync TODO.md
- `/todo lists` — show all lists
- `/todo create list Shopping` — create a new list

## Configuration

Add HTML comments at the top of your TODO.md to configure behavior:

```markdown
<!-- todo-tasks list: My Project -->
<!-- todo-tasks completed: delete -->
```

| Option | Default | Description |
|--------|---------|-------------|
| `list` | Folder name | Custom Google Tasks list name |
| `completed` | `keep` | `keep` preserves completed tasks, `delete` removes them from both sides |

## How sync works

todo-tasks uses a mapping file as the "last known state" to determine what changed on each side:

- **New locally** (in TODO.md but not mapping) → created in Google Tasks
- **New remotely** (in Google Tasks but not mapping) → added to TODO.md
- **Deleted locally** → deleted from Google Tasks
- **Deleted remotely** → removed from TODO.md
- **Completed** (either side) → kept as `[x]` (default) or deleted with config
- **Renamed** (fuzzy match) → updated on the other side

Mapping files are stored in `~/.todo-tasks/mappings/` (one per project, based on the file path).

## Security

- OAuth tokens and mapping files are stored with restricted permissions (0o600)
- The `~/.todo-tasks/` directory is set to 0o700
- No credentials are stored in the project directory or published to npm

## License

MIT
