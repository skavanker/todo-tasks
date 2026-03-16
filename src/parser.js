/**
 * Parses a TODO.md file into structured data.
 *
 * Returns an array of sections, each with items:
 * [
 *   {
 *     heading: "MVP",
 *     level: 2,
 *     items: [
 *       { text: "Task name", completed: false, due: null }
 *     ]
 *   }
 * ]
 */

const CONFIG_RE = /^<!--\s*todo-tasks\s+(\w+):\s*(.+?)\s*-->$/;
const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;
const TASK_RE = /^\s*[-*+]\s+\[([ xX])\]\s+(.+)$/;
const DATE_RE = /\s*\(date:\s*(\d{4}-\d{1,2}-\d{1,2}|\d{1,2}-\d{1,2})\)\s*/;

function parseDate(text) {
  const match = text.match(DATE_RE);
  if (!match) return null;

  let dateStr = match[1];
  // Pad single-digit month/day
  const parts = dateStr.split('-');
  if (parts.length === 2) {
    // MM-DD → current year
    dateStr = `${new Date().getFullYear()}-${parts[0].padStart(2, '0')}-${parts[1].padStart(2, '0')}`;
  } else {
    // YYYY-MM-DD
    dateStr = `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function stripMetadata(text) {
  return text.replace(DATE_RE, '').trim();
}

export function parse(markdown) {
  const lines = markdown
    .replace(/^\uFEFF/, '')   // Strip BOM
    .replace(/\r\n?/g, '\n')  // Normalize line endings (CRLF and bare CR)
    .split('\n');

  const config = {};
  const lists = [];
  let currentList = null;

  for (const line of lines) {
    const configMatch = line.match(CONFIG_RE);
    if (configMatch) {
      config[configMatch[1]] = configMatch[2];
      continue;
    }

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const heading = headingMatch[2];
      // Merge duplicate headings
      const existing = lists.find((l) => l.heading === heading);
      if (existing) {
        currentList = existing;
      } else {
        currentList = { heading, level: headingMatch[1].length, items: [] };
        lists.push(currentList);
      }
      continue;
    }

    const taskMatch = line.match(TASK_RE);
    if (taskMatch) {
      const [, check, rawText] = taskMatch;
      const text = stripMetadata(rawText);

      // Skip tasks with empty text (e.g. just a date annotation)
      if (!text) continue;

      // Default section for tasks before any heading
      if (!currentList) {
        currentList = { heading: 'Tasks', level: 2, items: [] };
        lists.push(currentList);
      }

      currentList.items.push({
        text,
        completed: check === 'x' || check === 'X',
        due: parseDate(rawText),
        notes: null,
      });
      continue;
    }

    // Non-checkbox indented lines → notes for the previous task
    if (currentList && currentList.items.length > 0 && /^\s+\S/.test(line)) {
      const lastItem = currentList.items[currentList.items.length - 1];
      const noteLine = line.trim();
      lastItem.notes = lastItem.notes ? lastItem.notes + '\n' + noteLine : noteLine;
    }
  }

  return { config, sections: lists };
}
