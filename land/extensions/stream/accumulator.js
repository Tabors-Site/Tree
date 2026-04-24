/**
 * Stream Accumulator
 *
 * Per-SOCKET message buffer. Mid-flight messages pile up here while a
 * turn is running; the tool-loop checkpoint or turn-end drains them and
 * injects them into the LLM context.
 *
 * Why per-socket, not per-ai-chat-session: different transports on the
 * same user may share an ai-chat session (when they pass matching
 * handles) but each has its own in-flight turn. Keying the accumulator
 * by session would let socket A's mid-flight message drain into socket
 * B's running turn — we saw this manifest as browser replies never
 * arriving and CLI turns dragging browser fragments into their responses.
 *
 * Each call to `createAccumulator()` returns a fresh state bag. The
 * stream extension creates one per socket in its register handler.
 */

export function createAccumulator() {
  let messages = [];
  let interrupt = false;
  return {
    push(message) {
      messages.push({ content: message, timestamp: Date.now() });
      interrupt = true;
    },
    checkInterrupt() {
      if (!interrupt) return null;
      interrupt = false;
      const out = messages;
      messages = [];
      return out;
    },
    size() { return messages.length; },
    clear() {
      messages = [];
      interrupt = false;
    },
  };
}
