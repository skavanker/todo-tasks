/**
 * Converts structured task data back to Markdown.
 * Inverse of parser.js.
 */

export function format(lists, config = {}) {
  const lines = [];

  for (const [key, value] of Object.entries(config)) {
    lines.push(`<!-- todo-tasks ${key}: ${value} -->`);
  }
  if (Object.keys(config).length > 0) lines.push('');

  for (const list of lists) {
    if (lines.length > 0) lines.push('');
    const hashes = '#'.repeat(list.level || 2);
    lines.push(`${hashes} ${list.heading}`);
    lines.push('');

    for (const item of list.items) {
      lines.push(formatTask(item));
      if (item.notes) {
        for (const noteLine of item.notes.split('\n')) {
          lines.push(`  ${noteLine}`);
        }
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

function formatTask(task) {
  const check = task.completed ? 'x' : ' ';
  const date = formatDate(task.due);
  return `- [${check}] ${task.text}${date}`;
}
