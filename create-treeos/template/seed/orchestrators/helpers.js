// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Shared utilities for orchestrator pipelines.
 * parseJsonSafe is the single JSON extraction function for every LLM response.
 * Must handle: raw objects, markdown fences, think tags, trailing commas,
 * single-quoted JSON, BOM, zero-width chars, prose around JSON, and
 * pathological input without hanging.
 */

const MAX_PARSE_INPUT = 200000; // 200KB. Anything larger is not JSON from an LLM.

/**
 * Safely extract and parse JSON from LLM text output.
 * Returns the parsed object/array, or null if no valid JSON found.
 *
 * Handles:
 *   - Raw objects (already parsed)
 *   - Markdown fences (```json ... ```)
 *   - <think>...</think> reasoning traces (deepseek, qwen)
 *   - Trailing commas
 *   - Single-quoted JSON keys/values (common in cheap models)
 *   - BOM and zero-width characters
 *   - Prose before/after JSON
 *   - Pathological input (size-capped, non-backtracking patterns)
 */
export function parseJsonSafe(text) {
  try {
    // Already parsed
    if (typeof text === "object" && text !== null) return text;
    if (typeof text !== "string") return null;

    // Size cap: prevent regex from running on multi-MB strings
    let cleaned = text.length > MAX_PARSE_INPUT ? text.slice(0, MAX_PARSE_INPUT) : text;

    // Strip <think>...</think> blocks. Non-backtracking: match opening tag,
    // then consume everything up to closing tag (or end of string if unclosed).
    cleaned = cleaned.replace(/<think>[^]*?<\/think>/gi, "");

    // Strip markdown fences
    cleaned = cleaned.replace(/^```(?:json|javascript|js)?\s*\n?/gim, "").replace(/\n?```\s*$/gm, "");

    // Strip BOM and zero-width characters
    cleaned = cleaned.replace(/[\uFEFF\u200B-\u200D]/g, "");

    cleaned = cleaned.trim();

    // Phase 1: Try direct parse (fastest path for well-behaved models)
    try { return JSON.parse(cleaned); } catch {}

    // Phase 2: Fix common LLM JSON mistakes, then retry
    let fixed = cleaned;

    // Trailing commas (only inside braces/brackets context, not in prose)
    fixed = fixed.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");

    // Single-quoted JSON: 'key': 'value' -> "key": "value"
    // Only apply if the string looks like it's JSON (starts with { or [)
    if (fixed.startsWith("{") || fixed.startsWith("[")) {
      fixed = fixed.replace(/'/g, '"');
    }

    try { return JSON.parse(fixed); } catch {}

    // Phase 3: Extract JSON object. Use a balanced-brace scanner instead of
    // greedy regex. Greedy [\s\S]* captures from first { to LAST }, which
    // fails when prose contains multiple objects.
    const objStart = cleaned.indexOf("{");
    if (objStart >= 0) {
      const extracted = extractBalanced(cleaned, objStart, "{", "}");
      if (extracted) {
        try { return JSON.parse(extracted); } catch {}
        // Try with fixes applied
        let extFixed = extracted.replace(/,\s*}/g, "}").replace(/,\s*]/g, "]");
        if (extFixed.includes("'")) extFixed = extFixed.replace(/'/g, '"');
        try { return JSON.parse(extFixed); } catch {}
      }
    }

    // Phase 4: Extract JSON array
    const arrStart = cleaned.indexOf("[");
    if (arrStart >= 0) {
      const extracted = extractBalanced(cleaned, arrStart, "[", "]");
      if (extracted) {
        try { return JSON.parse(extracted); } catch {}
      }
    }

    return null;
  } catch {
    return null;
  }
}

/**
 * Extract a balanced substring from a string starting at `start`.
 * Tracks open/close nesting depth. Respects string literals.
 * Returns the balanced substring or null if unbalanced.
 */
function extractBalanced(str, start, open, close) {
  let depth = 0;
  let inString = false;
  let escape = false;
  let quote = "";

  for (let i = start; i < str.length; i++) {
    const ch = str[i];

    if (escape) {
      escape = false;
      continue;
    }

    if (ch === "\\") {
      escape = true;
      continue;
    }

    if (inString) {
      if (ch === quote) inString = false;
      continue;
    }

    if (ch === '"' || ch === "'") {
      inString = true;
      quote = ch;
      continue;
    }

    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return str.slice(start, i + 1);
    }
  }

  return null; // unbalanced
}

/**
 * No-op socket for background orchestrators that don't have a real WebSocket.
 * Satisfies the socket interface without emitting anything. Frozen to prevent
 * accidental or malicious mutation of the shared singleton.
 */
export const nullSocket = Object.freeze({
  id: "null-socket",
  emit: () => {},
  to: function () { return this; },
  broadcast: Object.freeze({ emit: () => {} }),
  userId: null,
  username: "system",
  visitorId: "system",
});
