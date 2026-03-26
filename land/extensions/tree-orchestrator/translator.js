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

// ── CLASSIFIER ──

const CLASSIFY_PROMPT = `Classify this message for a tree-structured knowledge system.

Return ONLY JSON:
{
  "intent": "place" | "query" | "destructive" | "defer" | "no_fit",
  "confidence": 0.0-1.0,
  "responseHint": "tone guidance",
  "summary": "one line for logs"
}

place: information to store. Notes, ideas, structure, edits.
query: questions, conversation, read-only. Default for ambiguous.
destructive: delete, move, merge, reorganize, cascade status changes.
defer: user explicitly says hold/park/save for later.
no_fit: zero connection to this tree's domain.

Edits to values/names are place, not destructive.
Lean toward place if ANY storable information exists.
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
    if (!r.intent || !["place", "query", "destructive", "defer", "no_fit"].includes(r.intent)) r.intent = "query";
    r.confidence = Math.max(0, Math.min(1, r.confidence ?? 0.5));
    r.responseHint = r.responseHint || "";
    r.summary = r.summary || message;
    r.llmProvider = llmProvider;
    return r;
  } catch (err) {
    log.error("Translator", "Classify failed:", err.message);
    return { intent: "query", confidence: 0.5, responseHint: "", summary: message, llmProvider };
  }
}

// ── TRANSLATOR (destructive only) ──

const TRANSLATE_PROMPT = `You are planning destructive tree operations: delete, move, merge, reorganize, status cascades.

The tree summary shows current structure. Plan concrete operations.

Return ONLY JSON:
{
  "plan": [{
    "intent": "navigate" | "query" | "structure" | "edit" | "notes" | "reflect" | "no_fit",
    "targetHint": "node name or null",
    "directive": "specific instruction for execution engine",
    "needsNavigation": true/false,
    "isDestructive": true/false
  }],
  "responseHint": "tone guidance",
  "summary": "one line",
  "confidence": 0.0-1.0
}

Rules:
- directive must be specific: "Delete node 'X' under 'Y'" not "remove stuff"
- targetHint is WHERE to go, not WHAT to create
- plan is usually 1 item, max 3
- place before you create: note on existing > edit > child > new branch
- cleanup requests need concrete proposals, not clarification questions
- nodes have state (sets, reps, dollars) = structure. Thoughts about things = notes`;

export async function translateDestructive({ message, userId, conversationMemory, treeSummary, signal, slot, rootId }) {
  const { client, model, llmProvider } = await getLlm(userId, rootId, "tree:structure", slot);

  let userContent = "";
  if (treeSummary) userContent += `Tree:\n${treeSummary}\n\n`;
  if (conversationMemory) userContent += `Recent:\n${conversationMemory}\n\n`;
  userContent += `Message: ${message}`;

  const response = await client.chat.completions.create(
    { model, messages: [
      { role: "system", content: TRANSLATE_PROMPT },
      { role: "user", content: userContent },
    ]},
    signal ? { signal } : {},
  );

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty translator response");

  try {
    const r = parseJsonSafe(raw);
    if (!r?.plan?.length) throw new Error("No plan");
    for (const op of r.plan) {
      op.intent = op.intent || "query";
      op.needsNavigation = op.needsNavigation ?? !!op.targetHint;
      op.isDestructive = op.isDestructive ?? false;
      op.directive = op.directive || message;
    }
    r.responseHint = r.responseHint || "";
    r.summary = r.summary || message;
    r.confidence = Math.max(0, Math.min(1, r.confidence ?? 0.5));
    r.llmProvider = llmProvider;
    return r;
  } catch (err) {
    log.error("Translator", "Translate failed:", err.message);
    return {
      plan: [{ intent: "query", targetHint: null, directive: message, needsNavigation: false, isDestructive: false }],
      responseHint: "", summary: message, confidence: 0.5, llmProvider,
    };
  }
}

export { translateDestructive as translate };