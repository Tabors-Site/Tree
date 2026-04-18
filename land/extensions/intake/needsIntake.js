// Heuristic: decide whether a caller's raw message needs to run through
// tree:intake before the domain architect runs. The drone role is a
// pre-stage; it's only worth invoking when the input isn't already a
// clean, short, structured premise.
//
// Domain-neutral. Same rules fire for book, code, research, curriculum.
// A caller (book-workspace /start, code-workspace dispatch, etc.) calls
// this to gate the two-stage pipeline.

const URL_RE = /\bhttps?:\/\/[^\s<>"'`]+/i;
const FILE_PATH_RE = /\b[\w\-./]+\.(md|txt|pdf|doc|docx|json|ya?ml|csv|html?)\b/i;
const INGESTION_PHRASES = [
  /\b(from|based\s+on|using|after|per)\s+(?:this|the)\b/i,
  /\b(read|parse|digest|ingest|summariz(?:e|ing))\s+(?:this|the|my|that)\b/i,
  /\bhere('s| is)\s+(?:a|the|my)\b/i,
  /\bfiction(ize|alize)?\s+(?:this|the|it)\b/i,
];

export const LONG_MESSAGE_THRESHOLD = 1500; // chars

/**
 * Returns true when the message looks "raw" enough that a distillation
 * pass will produce a cleaner premise than feeding it straight into the
 * architect. Conservative — it'd rather skip intake on a borderline
 * case than run intake on something that was already clean.
 */
export function needsIntake(message) {
  if (typeof message !== "string" || !message) return false;

  // Explicit URL → always intake (architect has no fetch tool)
  if (URL_RE.test(message)) return true;

  // Explicit file path reference → intake
  if (FILE_PATH_RE.test(message)) return true;

  // Long raw text → intake (architect would waste budget parsing it)
  if (message.length > LONG_MESSAGE_THRESHOLD) return true;

  // Ingestion-intent phrases → intake
  for (const pattern of INGESTION_PHRASES) {
    if (pattern.test(message)) return true;
  }

  return false;
}

/**
 * Extract URLs from a message for logging / traceability. Used by
 * callers that want to record what was fetched without re-parsing.
 */
export function extractUrls(message) {
  if (typeof message !== "string") return [];
  const out = [];
  const re = /\bhttps?:\/\/[^\s<>"'`]+/gi;
  let m;
  while ((m = re.exec(message)) !== null) out.push(m[0]);
  return out;
}
