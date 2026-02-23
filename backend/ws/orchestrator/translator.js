// ws/orchestrator/translator.js
// Translates natural user language into tree operations using the Tree Constitution.
// Sits between user input and the tree orchestrator.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getClientForUser } from "../conversation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Load constitution once at startup
const CONSTITUTION = readFileSync(
  join(__dirname, "treeConstitution.md"),
  "utf-8",
);

// ─────────────────────────────────────────────────────────────────────────
// SYSTEM PROMPT
// ─────────────────────────────────────────────────────────────────────────

const TRANSLATOR_SYSTEM_PROMPT = `
${CONSTITUTION}

────────────────────────────────────────────────────────
YOUR TASK
────────────────────────────────────────────────────────

Given a user message (and optionally recent conversation + current tree summary),
produce a PLAN of tree operations.

Return ONLY this JSON. No markdown. No explanation.

{
  "plan": [
    {
      "intent": "navigate" | "query" | "structure" | "edit" | "notes" | "reflect",
      "targetHint": string | null,
      "directive": string,
      "needsNavigation": boolean,
      "isDestructive": boolean
    }
  ],
  "responseHint": string,
  "summary": string
}

FIELD DEFINITIONS:

plan: Array of operations to execute, in order. Usually 1, sometimes 2-3.
  - intent: The type of tree operation.
      "navigate"  — move to a node (only when user explicitly asks to go somewhere)
      "query"     — read/answer a question about the tree (read-only)
      "structure" — create, move, or delete nodes/branches
      "edit"      — change node fields (name, values, goals, status, schedule)
      "notes"     — create, edit, or delete notes on a node
      "reflect"   — analyze the tree, find patterns, identify gaps
  - targetHint: Node name or keyword to locate. null if operating on root or current node.
  - directive: What to do, written in clear tree language. This is passed to the execution
    engine, so be specific: "Create child node 'Budget' under 'Japan Trip'" not "add budget stuff."
  - needsNavigation: true if we need to find a node by name/description first.
  - isDestructive: true for deletes, status cascades, bulk changes.

responseHint: Guidance for how the assistant should frame its response to the user.
  Examples: "Confirm the branch was created and ask if they want to add details"
            "Summarize what was found and highlight any gaps"
            "Acknowledge the note was saved, keep it brief"
  This should match the user's energy — brief for brief requests, thoughtful for big ones.

summary: One-line description for logs. e.g., "Create trip planning structure"

────────────────────────────────────────────────────────
TRANSLATION EXAMPLES
────────────────────────────────────────────────────────

Example 1 — DECOMPOSITION (Node Identity Test in action):

User: "add a daily workout — 3 sets of 20 pushups, pullups, ab rolls, and a 5k run"
→ {
    "plan": [
      {
        "intent": "structure",
        "targetHint": null,
        "directive": "Create branch 'Daily Workout' under current node with children: Pushups, Pullups, Ab Rolls, Running. Each is its own node because each has trackable state (sets, reps, distance).",
        "needsNavigation": false,
        "isDestructive": false
      },
      {
        "intent": "edit",
        "targetHint": "Pushups",
        "directive": "Set values on Pushups: sets=3, reps=20. Set values on Pullups: sets=3. Set values on Running: distance_km=5.",
        "needsNavigation": true,
        "isDestructive": false
      }
    ],
    "responseHint": "Confirm the workout was set up with each exercise as its own trackable item. Mention the values. Ask if they want to add goals or a schedule.",
    "summary": "Create workout structure with exercise nodes and values"
  }

Example 2 — IMPLICIT NAVIGATION (thought finds its home):

User: "the hotel should be near Shinjuku station"
(conversation context: user was working on Japan Trip tree)
→ {
    "plan": [
      {
        "intent": "notes",
        "targetHint": "Accommodation",
        "directive": "Create note on Accommodation: 'Hotel should be near Shinjuku station'",
        "needsNavigation": true,
        "isDestructive": false
      }
    ],
    "responseHint": "Brief confirmation. This is a preference, not a task — keep it light.",
    "summary": "Add location preference note to Accommodation"
  }

Example 3 — CONVERSATIONAL (no tree operation):

User: "hey, what's going on with this?"
→ {
    "plan": [
      {
        "intent": "query",
        "targetHint": null,
        "directive": "Read current node context and summarize its state — children, notes, values, what's active.",
        "needsNavigation": false,
        "isDestructive": false
      }
    ],
    "responseHint": "Give a natural overview of where things stand. Don't list everything mechanically — highlight what's interesting or needs attention.",
    "summary": "Overview of current state"
  }

────────────────────────────────────────────────────────
RULES
────────────────────────────────────────────────────────

1. ALWAYS return valid JSON. Nothing else.
2. Apply the Node Identity Test from the constitution. Things with trackable
   state (quantities, progress, schedules) become nodes. Thoughts about
   those things become notes. This is the most important decision you make.
3. plan usually has 1 item. Use 2-3 only when the request naturally
   decomposes (e.g., create structure THEN set values). Never more than 3.
4. directive must be specific enough for the execution engine to act without
   guessing. Include node names, values, note content.
5. Conversational messages (greetings, thanks, "what's up") use intent
   "query" — no mutation needed.
6. needsNavigation = true whenever targetHint is set. false when operating
   on root/current node or when no target needed.
7. responseHint guides tone and content for the response mode. Match the
   user's energy. Brief input → brief hint. Big request → richer hint.
8. directive is precise tree language even when the user is casual.
   User says "toss in a note" → directive says "Create note on X: '...'"
9. CRITICAL: targetHint is WHERE to go, not WHAT to create.
   "Add branches called X, Y, Z to MyProject" →
     targetHint: "MyProject" (the existing parent to navigate to)
     directive: "Create child nodes 'X', 'Y', 'Z' under MyProject"
   NEVER set targetHint to the names of things being created.
10. When no parent is mentioned ("add a branch called Notes"), operate on
    the current node: targetHint: null, needsNavigation: false.
`.trim();

// ─────────────────────────────────────────────────────────────────────────
// TRANSLATE
// ─────────────────────────────────────────────────────────────────────────

/**
 * Translate a user message into tree operations.
 *
 * @param {object} opts
 * @param {string} opts.message - The raw user message
 * @param {string} opts.visitorId - For memory context
 * @param {string} opts.userId - For LLM client resolution
 * @param {string} opts.conversationMemory - Formatted recent exchanges
 * @param {string|null} opts.treeSummary - Brief summary of current tree state
 * @param {AbortSignal} [opts.signal] - Cancellation signal
 *
 * @returns {object} { plan, responseHint, summary }
 */
export async function translate({
  message,
  userId,
  conversationMemory,
  treeSummary,
  signal,
}) {
  const { client: openai, model } = await getClientForUser(userId);

  // Build context block
  let contextBlock = "";
  if (conversationMemory) {
    contextBlock += `\nRecent conversation:\n${conversationMemory}\n`;
  }
  if (treeSummary) {
    contextBlock += `\nCurrent tree state:\n${treeSummary}\n`;
  }

  const userContent = contextBlock
    ? `${contextBlock}\nUser message: ${message}`
    : message;

  const response = await openai.chat.completions.create(
    {
      model,
      messages: [
        { role: "system", content: TRANSLATOR_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    },
    signal ? { signal } : {},
  );

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty translator response");

  try {
    const result = JSON.parse(raw);

    // Validate structure
    if (!result.plan || !Array.isArray(result.plan) || result.plan.length === 0) {
      throw new Error("Missing or empty plan");
    }

    // Ensure each plan item has required fields
    for (const op of result.plan) {
      if (!op.intent) op.intent = "query";
      if (op.needsNavigation === undefined) op.needsNavigation = !!op.targetHint;
      if (op.isDestructive === undefined) op.isDestructive = false;
      if (!op.directive) op.directive = message;
    }

    if (!result.responseHint) result.responseHint = "";
    if (!result.summary) result.summary = message;

    return result;
  } catch (err) {
    // If JSON parse fails, return a safe fallback
    console.error("❌ Translator parse failed:", err.message, "raw:", raw);
    return {
      plan: [
        {
          intent: "query",
          targetHint: null,
          directive: message,
          needsNavigation: false,
          isDestructive: false,
        },
      ],
      responseHint: "Respond naturally to the user's message.",
      summary: message,
    };
  }
}