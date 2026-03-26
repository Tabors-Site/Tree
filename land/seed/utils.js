// TreeOS Seed . AGPL-3.0 . https://treeos.ai
// Kernel string utilities.

/**
 * Escape a string for safe use in a RegExp constructor.
 */
export function escapeRegex(str) {
  if (typeof str !== "string") return "";
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Check if a string contains HTML tags.
 */
export function containsHtml(str) {
  if (typeof str !== "string") return false;
  return /<[a-zA-Z/][^>]*>/.test(str);
}
