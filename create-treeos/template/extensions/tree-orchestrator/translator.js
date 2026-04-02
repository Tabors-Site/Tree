import log from "../../seed/log.js";
import { parseJsonSafe } from "../../seed/orchestrators/helpers.js";

let resolveRootLlmForMode, getClientForUser;

export function setServices({ llm }) {
  resolveRootLlmForMode = llm.resolveRootLlmForMode;
  getClientForUser = llm.getClientForUser;
}

async function getLlm(userId, rootId, modeKey, slot) {
  const overrideId = rootId ? await resolveRootLlmForMode(rootId, modeKey) : null;
  const { client, model, isCustom, connectionId, noLlm } = await getClientForUser(userId, slot, overrideId);
  if (noLlm) throw new Error("NO_LLM");
  return { client, model, llmProvider: { isCustom, model, connectionId: connectionId || null } };
}

// ── CLASSIFIER (opt-in LLM classification) ──

const CLASSIFY_PROMPT = `Classify this message for a tree-structured knowledge system.

Return ONLY JSON:
{
  "intent": "extension" | "converse" | "defer" | "no_fit",
  "confidence": 0.0-1.0,
  "responseHint": "tone guidance",
  "summary": "one line for logs"
}

extension: message clearly targets a specific extension's domain (food, fitness, kb, browser, etc.)
converse: general conversation, questions, thoughts, actions. The default.
defer: user explicitly says hold/park/save for later.
no_fit: zero connection to this tree's domain.

Lean toward converse. The AI at the position will figure out what to do.
no_fit means genuinely unrelated, not just tangential.
Match confidence to domain fit. 0.85+ for obvious. 0.3 for stretch. 0.0 for no_fit.`;

export async function classify({ message, userId, conversationMemory, treeSummary, signal, slot, rootId }) {
  const { client, model, llmProvider } = await getLlm(userId, rootId, "tree:librarian", slot);

  let userContent = "";
  if (treeSummary) userContent += `Tree:\n${treeSummary}\n\n`;
  if (conversationMemory) userContent += `Recent:\n${conversationMemory}\n\n`;
  userContent += `Message: ${message}`;

  const response = await client.chat.completions.create(
    { model, messages: [
      { role: "system", content: CLASSIFY_PROMPT },
      { role: "user", content: userContent },
    ]},
    signal ? { signal } : {},
  );

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty classifier response");

  try {
    const r = parseJsonSafe(raw);
    if (!r) throw new Error("No JSON");
    if (!r.intent || !["extension", "converse", "defer", "no_fit"].includes(r.intent)) r.intent = "converse";
    r.confidence = Math.max(0, Math.min(1, r.confidence ?? 0.5));
    r.responseHint = r.responseHint || "";
    r.summary = r.summary || message;
    r.llmProvider = llmProvider;
    return r;
  } catch (err) {
    log.error("Translator", "Classify failed:", err.message);
    return { intent: "converse", confidence: 0.5, responseHint: "", summary: message, llmProvider };
  }
}
