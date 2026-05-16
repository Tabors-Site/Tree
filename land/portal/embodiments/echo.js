// TreeOS IBP — echo embodiment (Phase 4 demonstration).
//
// The simplest possible sync-respond embodiment. Proves the TALK
// round-trip without requiring an LLM. Echoes whatever was sent.
//
// Honored intents: all four (chat/place/query/be). For `place`, the
// embodiment honors the intent (no INVALID_INTENT) but produces no
// response (place expects none). For the others, it returns a response.
//
// respondMode: sync — the response returns inline on the TALK ack.
//
// triggerOn: ["message"] — summon immediately on inbox-write.

export const echoEmbodiment = Object.freeze({
  name: "echo",
  honoredIntents: ["chat", "place", "query", "be"],
  respondMode: "sync",
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
