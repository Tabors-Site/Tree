/**
 * Shared utilities for orchestrator pipelines.
 */

/**
 * Safely extract and parse JSON from LLM text output.
 * Handles raw objects, JSON embedded in markdown, and malformed responses.
 */
export function parseJsonSafe(text) {
  try {
    if (typeof text === "object" && text !== null) return text;
    const match = text.match(/\{[\s\S]*\}/);
    return match ? JSON.parse(match[0]) : null;
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
