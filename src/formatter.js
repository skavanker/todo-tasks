/**
 * Converts structured task data back to Markdown.
 * Inverse of parser.js.
 */

export function format(lists) {
  const lines = [];

  for (const list of lists) {
    if (lines.length > 0) lines.push('');
    const hashes = '#'.repeat(list.level || 2);
    lines.push(`${hashes} ${list.heading}`);
    lines.push('');

    for (const item of list.items) {
      lines.push(formatTask(item, 0));

      for (const sub of item.subtasks) {
        lines.push(formatTask(sub, 1));
      }
    }
  }

  return lines.join('\n') + '\n';
}

function formatDate(due) {
  if (!due) return '';
  const d = new Date(due);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const currentYear = new Date().getFullYear();

  if (year === currentYear) {
    return ` (date: ${month}-${day})`;
  }
  return ` (date: ${year}-${month}-${day})`;
}

function formatTask(task, depth) {
  const indent = '  '.repeat(depth);
  const check = task.completed ? 'x' : ' ';
  const date = formatDate(task.due);
  return `${indent}- [${check}] ${task.text}${date}`;
}
