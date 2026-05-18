// TreeOS IBP — echo being (substrate smoke test).
//
// The simplest possible async-respond being. Proves the SUMMON
// round-trip through the queue substrate without requiring an LLM.
// Echoes whatever was sent.
//
// Honored intents: all four (chat/place/query/be). For `place`, the
// being honors the intent (no INVALID_INTENT) but produces no
// response (place expects none). For the others, it returns a response.
//
// respondMode: async — SUMMON ACKs accepted; the scheduler runs this
// being serially per being, with priority ordering, and pushes
// the response through the handoff registered by the verb handler.
// Sync was the Phase 4 placeholder; the queue substrate landed in
// Slice 2 of the queue-driven shift, and echo is its smoke test.
//
// triggerOn: ["message"] — summon immediately on inbox-write.

export const echoEmbodiment = Object.freeze({
  name: "echo",
  honoredIntents: ["chat", "place", "query", "be"],
  respondMode: "async",
  triggerOn: ["message"],
  async summon(message, _ctx) {
    if (message.intent === "place") {
      // place: no response is produced (the protocol still ACKs).
      return null;
    }
    const inputText = stringifyContent(message.content);
    return {
      content: `echo: ${inputText}`,
      intent: message.intent,
    };
  },
});

function stringifyContent(content) {
  if (typeof content === "string") return content;
  if (content === null || content === undefined) return "";
  try {
    return JSON.stringify(content);
  } catch {
    return String(content);
  }
}
