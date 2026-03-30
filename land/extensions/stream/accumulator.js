/**
 * Stream Accumulator
 *
 * Per-session message buffer. When the AI is working, incoming messages
 * accumulate here. The tool loop checkpoint reads them and injects them
 * into the conversation. Stateless. No DB. Memory only.
 */

const buffers = new Map(); // visitorId -> { messages: [], interrupt: false }

export function pushMessage(visitorId, message) {
  if (!buffers.has(visitorId)) {
    buffers.set(visitorId, { messages: [], interrupt: false });
  }
  const buf = buffers.get(visitorId);
  buf.messages.push({ content: message, timestamp: Date.now() });
  buf.interrupt = true;
}

export function checkInterrupt(visitorId) {
  const buf = buffers.get(visitorId);
  if (!buf || !buf.interrupt) return null;
  buf.interrupt = false;
  const messages = buf.messages.splice(0);
  return messages;
}

export function clear(visitorId) {
  buffers.delete(visitorId);
}
