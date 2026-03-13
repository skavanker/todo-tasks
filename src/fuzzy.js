/**
 * Levenshtein distance between two strings.
 */
export function levenshtein(a, b) {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;

  const row = Array.from({ length: b.length + 1 }, (_, i) => i);

  for (let i = 1; i <= a.length; i++) {
    let prev = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(
        row[j] + 1,        // deletion
        prev + 1,           // insertion
        row[j - 1] + cost,  // substitution
      );
      row[j - 1] = prev;
      prev = val;
    }
    row[b.length] = prev;
  }

  return row[b.length];
}

/**
 * Computes similarity between two strings (0 = completely different, 1 = identical).
 */
export function similarity(a, b) {
  if (a === b) return 1;
  const maxLen = Math.max(a.length, b.length);
  if (maxLen === 0) return 1;
  return 1 - levenshtein(a, b) / maxLen;
}

/**
 * Matches unmatched local strings against unmatched remote strings using fuzzy matching.
 * Returns an array of { local, remote, score } pairs above the threshold.
 * Uses greedy best-match-first strategy.
 */
export function fuzzyMatch(localStrings, remoteStrings, threshold = 0.6) {
  if (!localStrings.length || !remoteStrings.length) return [];

  // Build similarity matrix
  const scores = [];
  for (const local of localStrings) {
    for (const remote of remoteStrings) {
      const score = similarity(local, remote);
      if (score >= threshold) {
        scores.push({ local, remote, score });
      }
    }
  }

  // Greedy: pick best matches first
  scores.sort((a, b) => b.score - a.score);

  const usedLocal = new Set();
  const usedRemote = new Set();
  const matches = [];

  for (const entry of scores) {
    if (usedLocal.has(entry.local) || usedRemote.has(entry.remote)) continue;
    matches.push(entry);
    usedLocal.add(entry.local);
    usedRemote.add(entry.remote);
  }

  return matches;
}
