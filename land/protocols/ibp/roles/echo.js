// TreeOS IBP — echo being (substrate smoke test).
//
// The simplest possible async-respond being. Proves the SUMMON
// round-trip through the queue substrate without requiring an LLM.
// Echoes whatever was sent.
//
// respondMode: async — SUMMON ACKs accepted; the scheduler runs this
// being serially per being, with priority ordering, and pushes
// the response through the handoff registered by the verb handler.
//
// triggerOn: ["message"] — summon immediately on inbox-write.

export const echoEmbodiment = Object.freeze({
  name: "echo",
  // No tools used, no LLM call — permissions inherit the default
  // (all three). They don't gate anything here but stay coherent
  // with the role-permissions architecture.
  permissions: ["see", "do", "summon"],
  respondMode: "async",
  triggerOn: ["message"],
  async summon(message, _ctx) {
    const inputText = stringifyContent(message.content);
    return {
      content: `echo: ${inputText}`,
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
