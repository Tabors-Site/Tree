// TreeOS Seed . AGPL-3.0 . https://treeos.ai
/**
 * Shared utilities for orchestrator pipelines.
 */

/**
 * Safely extract and parse JSON from LLM text output.
 * Handles raw objects, markdown fences, <think> tags, and malformed responses.
 */
export function parseJsonSafe(text) {
  try {
    if (typeof text === "object" && text !== null) return text;
    if (typeof text !== "string") return null;

    let cleaned = text;

    // Strip <think>...</think> blocks (deepseek, qwen reasoning traces)
    cleaned = cleaned.replace(/<think>[\s\S]*?<\/think>/gi, "");

    // Strip markdown fences (```json ... ``` or ``` ... ```)
    cleaned = cleaned.replace(/^```(?:json|javascript|js)?\s*\n?/gim, "").replace(/\n?```\s*$/gm, "");

    // Strip leading/trailing prose around JSON (some models add explanations)
    cleaned = cleaned.trim();

    // Strip BOM and zero-width characters
    cleaned = cleaned.replace(/^\uFEFF/, "").replace(/[\u200B-\u200D\uFEFF]/g, "");

    // Fix common LLM JSON mistakes
    cleaned = cleaned.replace(/,\s*([}\]])/g, "$1");  // trailing commas
    cleaned = cleaned.replace(/'/g, '"');                // single quotes -> double (only in JSON context)

    // Try direct parse
    try { return JSON.parse(cleaned); } catch {}

    // Extract first JSON object
    const objMatch = cleaned.match(/\{[\s\S]*\}/);
    if (objMatch) { try { return JSON.parse(objMatch[0]); } catch {} }

    // Extract first JSON array
    const arrMatch = cleaned.match(/\[[\s\S]*\]/);
    if (arrMatch) { try { return JSON.parse(arrMatch[0]); } catch {} }

    return null;
  } catch {
    return null;
  }
}

/**
 * No-op socket for background orchestrators that don't have a real WebSocket connection.
 * Satisfies the socket interface without emitting anything.
 */
export const nullSocket = {
  emit: () => {},
  to: function () { return this; },
  broadcast: { emit: () => {} },
};
