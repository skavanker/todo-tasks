/**
 * Parses a TODO.md file into structured data.
 *
 * Returns an array of sections, each with items:
 * [
 *   {
 *     heading: "MVP",
 *     level: 2,
 *     items: [
 *       { text: "Task name", completed: false, due: null, starred: false, subtasks: [...] }
 *     ]
 *   }
 * ]
 */

const HEADING_RE = /^(#{1,6})\s+(.+)$/;
const TASK_RE = /^(\s*)- \[([ x])\]\s+(.+)$/;
const DATE_RE = /\s*\(date:\s*(\d{4}-\d{2}-\d{2}|\d{2}-\d{2})\)\s*/;
function parseDate(text) {
  const match = text.match(DATE_RE);
  if (!match) return null;

  let dateStr = match[1];
  // No year → current year
  if (dateStr.length === 5) {
    dateStr = `${new Date().getFullYear()}-${dateStr}`;
  }

  const [year, month, day] = dateStr.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toISOString();
}

function stripMetadata(text) {
  return text.replace(DATE_RE, '').trim();
}

export function parse(markdown) {
  const lines = markdown.split('\n');
  const lists = [];
  let currentList = null;

  for (const line of lines) {
    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      currentList = { heading: headingMatch[2], level: headingMatch[1].length, items: [] };
      lists.push(currentList);
      continue;
    }

    if (!currentList) continue;

    const taskMatch = line.match(TASK_RE);
    if (!taskMatch) continue;

    const [, indent, check, rawText] = taskMatch;
    const task = {
      text: stripMetadata(rawText),
      completed: check === 'x',
      due: parseDate(rawText),
      subtasks: [],
    };

    if (indent.length >= 2 && currentList.items.length > 0) {
      currentList.items[currentList.items.length - 1].subtasks.push(task);
    } else {
      currentList.items.push(task);
    }
  }

  return lists;
}
