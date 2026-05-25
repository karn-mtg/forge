/**
 * HTML-escape a string for safe injection into innerHTML / template strings.
 * Covers the five characters that matter for HTML attribute + text contexts.
 */
export function esc(s: string): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
