// orchestrators/translator.js
// Translates natural user language into tree operations using the Tree Constitution.
// Sits between user input and the tree orchestrator.

import log from "../../core/log.js";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getClientForUser, resolveRootLlmForMode } from "../../ws/conversation.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Robust JSON parser for LLM output -- handles markdown fences, <think> tags, prose wrapping
function parseLlmJson(text) {
  if (!text || typeof text !== "string") return null;
  var cleaned = text.replace(/^```(?:json)?\s*\n?/i, "").replace(/\n?```\s*$/, "");
  cleaned = cleaned.replace(/^<think>[\s\S]*?<\/think>\s*/i, "");
  try { return JSON.parse(cleaned); } catch {}
  var match = cleaned.match(/\{[\s\S]*\}/);
  if (match) { try { return JSON.parse(match[0]); } catch {} }
  return null;
}

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
YOUR TASK: PLAN DESTRUCTIVE OPERATIONS
────────────────────────────────────────────────────────

You receive a thought, idea, or request. Your job is to decide:

1. Does this belong in this tree at all?
2. If yes — WHERE does it go? (Existing node? New child? New branch?)
3. WHAT is it? (A note? A value change? New structure?)
4. HOW confident are you?

Follow the Placement Strategy from the constitution:
  Note on existing node > Edit existing node > Child under existing branch >
  New top-level branch > No fit

Most thoughts are notes on things that already exist. Structure is expensive.
Don't create what you can place.

Return ONLY this JSON. No markdown. No explanation.

{
  "plan": [
    {
      "intent": "navigate" | "query" | "structure" | "edit" | "notes" | "reflect" | "no_fit",
      "targetHint": string | null,
      "directive": string,
      "needsNavigation": boolean,
      "isDestructive": boolean
    }
  ],
  "responseHint": string,
  "summary": string,
  "confidence": number
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
      "no_fit"    — this message does NOT belong in this tree. The idea, thought,
                     or request has no meaningful connection to the tree's domain.
                     Use this when placing it here would pollute the tree's structure.
  - targetHint: Node name or keyword to locate. null if operating on root or current node.
  - directive: What to do, written in clear tree language. This is passed to the execution
    engine, so be specific: "Create child node 'Budget' under 'Japan Trip'" not "add budget stuff."
    For no_fit: explain WHY it doesn't belong.
  - needsNavigation: true if we need to find a node by name/description first.
  - isDestructive: true for deletes, status cascades, bulk changes.

responseHint: Guidance for how the assistant should frame its response to the user.
  Examples: "Confirm the branch was created and ask if they want to add details"
            "Summarize what was found and highlight any gaps"
            "Acknowledge the note was saved, keep it brief"
  This should match the user's energy — brief for brief requests, thoughtful for big ones.

summary: One-line description for logs. e.g., "Create trip planning structure"

confidence: 0.0 to 1.0 — how confident you are that this plan is correct for this tree.
  1.0 = obviously belongs here (e.g., "add pushups" on a Fitness tree)
  0.7 = reasonable fit, could work (e.g., "meal prep" on a Health tree)
  0.3 = stretch, only vaguely related (e.g., "buy groceries" on a Fitness tree)
  0.0 = no_fit, doesn't belong at all (e.g., "japan trip thoughts" on a Fitness tree)

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
    "summary": "Create workout structure with exercise nodes and values",
    "confidence": 0.95
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
    "summary": "Add location preference note to Accommodation",
    "confidence": 0.9
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
    "summary": "Overview of current state",
    "confidence": 0.8
  }

Example 4 — NO FIT (idea doesn't belong in this tree):

User: "I need to book a dentist appointment next Tuesday"
(tree: "Japan Trip" with branches Flights, Accommodation, Itinerary, Budget)
→ {
    "plan": [
      {
        "intent": "no_fit",
        "targetHint": null,
        "directive": "A dentist appointment is a personal health/scheduling task unrelated to trip planning. Does not belong in the Japan Trip tree.",
        "needsNavigation": false,
        "isDestructive": false
      }
    ],
    "responseHint": "",
    "summary": "Dentist appointment — not related to Japan Trip",
    "confidence": 0.0
  }

Example 5 — PLACEMENT (note on existing, not new structure):

User: "flights seem cheaper in late March"
(tree: "Japan Trip" with branches Flights, Accommodation, Itinerary, Budget)
→ {
    "plan": [
      {
        "intent": "notes",
        "targetHint": "Flights",
        "directive": "Create note on Flights: 'Flights seem cheaper in late March'",
        "needsNavigation": true,
        "isDestructive": false
      }
    ],
    "responseHint": "Brief confirmation. This is a research observation — keep it light.",
    "summary": "Note on Flights about March pricing",
    "confidence": 0.95
  }

Why notes, not structure? "Flights seem cheaper in late March" is a thought
ABOUT flights — not a new trackable thing. The Flights branch already exists.
Place the thought where it belongs.

Example 6 — CLEANUP JUDGMENT (steward evaluates fit):

User: "remove anything that doesn't belong"
(tree: "LLM Orchestration" with branches Content, 10x10 Plan - Make a Million Dollars)
→ {
    "plan": [
      {
        "intent": "structure",
        "targetHint": "10x10 Plan - Make a Million Dollars",
        "directive": "Delete node '10x10 Plan - Make a Million Dollars'. A financial get-rich plan is unrelated to LLM orchestration.",
        "needsNavigation": true,
        "isDestructive": true
      }
    ],
    "responseHint": "Explain that '10x10 Plan - Make a Million Dollars' doesn't fit the LLM Orchestration domain and propose its removal. 'Content' seems like it could be relevant and should stay.",
    "summary": "Remove '10x10 Plan' — doesn't fit LLM Orchestration tree",
    "confidence": 0.9
  }

Why a concrete plan, not a query? The user said "remove what doesn't belong."
The tree summary shows the branches. You can evaluate each one against the
root domain. "10x10 Plan - Make a Million Dollars" is clearly unrelated to
LLM orchestration. Don't ask "which ones?" — you already know. The user
can reject the proposal. But you must MAKE the proposal.

Example 7 — LOW CONFIDENCE (tangentially related):

User: "I should start learning some basic Japanese phrases"
(tree: "Japan Trip" with branches Flights, Accommodation, Itinerary, Budget)
→ {
    "plan": [
      {
        "intent": "structure",
        "targetHint": null,
        "directive": "Create node 'Japanese Phrases' under root. This is trip preparation — learning basics for the trip.",
        "needsNavigation": false,
        "isDestructive": false
      }
    ],
    "responseHint": "Confirm the branch was created. Note it's a good addition for trip prep.",
    "summary": "Create Japanese phrases branch for trip prep",
    "confidence": 0.6
  }

Example 8 — STRUCTURED DUMP (decompose, don't paste):

User: "Weekly Workout Plan: Monday: Chest & Triceps – Bench press 4x10, Incline dumbbell press 3x12, Tricep dips 3x15. Tuesday: Back & Biceps – Pull-ups 4x8, Bent-over rows 3x10. Wednesday: Rest or Light Cardio – 30 min walk."
→ {
    "plan": [
      {
        "intent": "structure",
        "targetHint": null,
        "directive": "Create branch with type 'plan' named 'Weekly' with children: 'Monday' (type: task, children: 'Bench' with values sets=4 reps=10, 'Incline DB Press' values sets=3 reps=12, 'Dips' values sets=3 reps=15), 'Tuesday' (type: task, children: 'Pull-ups' values sets=4 reps=8, 'Rows' values sets=3 reps=10), 'Wednesday' (type: task) with note 'Rest or light cardio, 30 min walk or cycling'.",
        "needsNavigation": false,
        "isDestructive": false
      }
    ],
    "responseHint": "Confirm the weekly plan is set up with each day and exercise as its own trackable node. Quick and natural.",
    "summary": "Decompose weekly workout into structured tree with days and exercises",
    "confidence": 0.95
  }

Why full decomposition? The input has clear hierarchy: week > days > exercises.
Each exercise has trackable state (sets, reps). Pasting this as one note or
one long node name wastes the tree. Decompose into structure with short names.
"Bench" not "Bench Press 4x10" (the values carry the numbers). "Monday" not
"Monday: Chest & Triceps" (children show what's in it).

────────────────────────────────────────────────────────
RULES
────────────────────────────────────────────────────────

1. ALWAYS return valid JSON. Nothing else.
2. PLACE BEFORE YOU CREATE. Look at the tree summary. If an existing
   node covers this thought, place a note or edit — don't create structure.
   Most incoming thoughts are notes. Default to "notes" intent unless
   the thought genuinely introduces trackable state.
3. Apply the Node Identity Test. If it has measurable, changing state →
   node. If it's a thought about something → note. When unsure, it's a note.
   BUT: if the input contains lists, schedules, or multi-part plans with
   internal hierarchy, DECOMPOSE into structure with types. Don't paste
   structured content as a flat note.
4. STRUCTURE IS EXPENSIVE. Every new node changes the tree's shape
   permanently. A new top-level branch is a major decision. Prefer:
   note on existing > edit existing > child of existing > new branch.
5. plan usually has 1 item. Use 2-3 only when the request naturally
   decomposes (e.g., create structure THEN set values). Never more than 3.
6. directive must be specific enough for the execution engine to act without
   guessing. Include node names, values, note content.
7. Conversational messages (greetings, thanks, "what's up") use intent
   "query" — no mutation needed.
8. needsNavigation = true whenever targetHint is set. false when operating
   on root/current node or when no target needed.
9. responseHint guides tone and content for the response mode. Match the
   user's energy. Brief input → brief hint. Big request → richer hint.
10. directive is precise tree language even when the user is casual.
    User says "toss in a note" → directive says "Create note on X: '...'"
11. CRITICAL: targetHint is WHERE to go, not WHAT to create.
    "Add branches called X, Y, Z to MyProject" →
      targetHint: "MyProject" (the existing parent to navigate to)
      directive: "Create child nodes 'X', 'Y', 'Z' under MyProject"
    NEVER set targetHint to the names of things being created.
12. When no parent is mentioned ("add a branch called Notes"), operate on
    the current node: targetHint: null, needsNavigation: false.
13. confidence reflects how well this idea fits THIS tree's domain.
    Be honest — a stretch is a stretch. The system uses this to decide
    whether to try other trees or ask the user. A no_fit MUST have
    confidence 0.0. A perfect fit should be 0.85+.
14. no_fit means the idea has NO meaningful connection to this tree.
    Don't use no_fit for tangential ideas that could reasonably extend
    the tree — use a low confidence (0.3-0.5) with a real plan instead.
    no_fit is for genuinely unrelated content.
15. When the tree summary shows existing branches, USE THEM. If the user
    says "flights are expensive" and a Flights branch exists, that's a
    note on Flights — not a new node, not a note on root.
16. CLEANUP REQUESTS REQUIRE JUDGMENT, NOT CLARIFICATION. When the user
    says "clean up", "remove what doesn't belong", "organize this" — you
    have the tree summary. Evaluate each branch against the root's domain.
    Produce a concrete plan to remove/restructure misfits. NEVER respond
    with "ask the user what to remove" when the tree summary gives you
    enough to make a judgment. The user can reject your proposal — but
    you must make one. "Query" intent for cleanup is almost always wrong.
`.trim();

// ─────────────────────────────────────────────────────────────────────────
// CLASSIFIER — lightweight intent classification for the librarian flow
// ─────────────────────────────────────────────────────────────────────────

const CLASSIFIER_SYSTEM_PROMPT = `
You classify user messages into one of five intents for a tree knowledge system.
You receive the message, the tree's current structure, and recent conversation.

Return ONLY this JSON. No markdown. No explanation.

{
  "intent": "place" | "query" | "destructive" | "defer" | "no_fit",
  "confidence": number,
  "responseHint": string,
  "summary": string,
  "placementAxes": { "pathConfidence": number, "domainNovelty": number, "relationalComplexity": number } | null
}

INTENTS:

place . User has information to store: notes, ideas, new structure, edits to values/goals/names.
  "flights are cheaper in March", "add a workout routine", "budget is $3500"

query . User is asking a question or just talking. No tree changes.
  "what should I do next?", "how's the budget?", "hey", "thanks"

destructive . User wants to delete, move, merge, reorganize, or cascade status changes.
  "delete the old workout branch", "move Backend under Projects", "mark everything complete"

defer . User explicitly says to hold the idea for later: "save this", "park this", "defer"

no_fit . The idea has ZERO connection to this tree's domain.
  A dentist appointment on a Japan Trip tree. A recipe on a Fitness tree.

CONFIDENCE: 1.0 = obvious fit. 0.7 = reasonable. 0.3 = stretch. 0.0 = no_fit.

PLACEMENT AXES (only when intent is "place", null otherwise):
  pathConfidence: Can this map to an EXISTING node? 0.9 = exact match exists. 0.5 = related branch. 0.2 = would need new structure. 1.0 = user explicitly says "create/build X".
  domainNovelty: Is this a new top-level area? 0.9 = brand new. 0.1 = fits existing branches.
  relationalComplexity: Does this bridge multiple existing branches? 0.8 = yes. 0.1 = single branch.

RULES:
- Lean toward "place" if the message contains ANY storable information.
- Edits to values/goals/names are "place", not "destructive".
- no_fit means genuinely unrelated. A stretch is "place" with low confidence.
- "create/build/plan X" is always "place" with pathConfidence=1.0, never defer.
- Casual fragments ("thinking about health stuff") get LOW pathConfidence.
- responseHint guides tone for the response. Match the user's energy.
- summary is one line for logs.
`.trim();

/**
 * Classify a user message into a high-level intent.
 * Lightweight alternative to full translation — used by the librarian flow.
 *
 * @param {object} opts
 * @param {string} opts.message - The raw user message
 * @param {string} opts.userId - For LLM client resolution
 * @param {string} opts.conversationMemory - Formatted recent exchanges
 * @param {string|null} opts.treeSummary - Brief summary of current tree state
 * @param {AbortSignal} [opts.signal] - Cancellation signal
 *
 * @returns {object} { intent, confidence, responseHint, summary }
 */
export async function classify({
  message,
  userId,
  conversationMemory,
  treeSummary,
  signal,
  slot,
  rootId,
}) {
  const overrideId = rootId ? await resolveRootLlmForMode(rootId, "tree:librarian") : null;
  const { client: openai, model, isCustom, connectionId, noLlm } = await getClientForUser(userId, slot, overrideId);
  if (noLlm) throw new Error("NO_LLM");
  const _llmProvider = { isCustom, model, connectionId: connectionId || null };

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
        { role: "system", content: CLASSIFIER_SYSTEM_PROMPT },
        { role: "user", content: userContent },
      ],
    },
    signal ? { signal } : {},
  );

  const raw = response.choices?.[0]?.message?.content;
  if (!raw) throw new Error("Empty classifier response");

  try {
    const result = parseLlmJson(raw);
    if (!result) throw new Error("No parseable JSON found");

    // Validate and default fields
    if (!result.intent) result.intent = "query";
    if (!["place", "query", "destructive", "no_fit"].includes(result.intent)) {
      result.intent = "query";
    }
    if (result.confidence === undefined) result.confidence = 0.5;
    result.confidence = Math.max(0, Math.min(1, result.confidence));
    if (!result.responseHint) result.responseHint = "";
    if (!result.summary) result.summary = message;

    // Validate placementAxes — only meaningful for "place" intent
    if (result.intent === "place" && result.placementAxes) {
      const ax = result.placementAxes;
      const clamp = (v) => Math.max(0, Math.min(1, Number(v) || 0));
      result.placementAxes = {
        pathConfidence: clamp(ax.pathConfidence),
        domainNovelty: clamp(ax.domainNovelty),
        relationalComplexity: clamp(ax.relationalComplexity),
      };
    } else {
      result.placementAxes = null;
    }

    result.llmProvider = _llmProvider;
    return result;
  } catch (err) {
 log.error("Tree Orchestrator", " Classifier parse failed:", err.message, "raw:", raw);
    return {
      intent: "query",
      confidence: 0.5,
      responseHint: "Respond naturally to the user's message.",
      summary: message,
      placementAxes: null,
      llmProvider: _llmProvider,
    };
  }
}

// ─────────────────────────────────────────────────────────────────────────
// TRANSLATE DESTRUCTIVE — full translation for destructive operations only
// ─────────────────────────────────────────────────────────────────────────

/**
 * Translate a user message into detailed tree operations.
 * Used for destructive operations (delete, move, merge, status changes)
 * that need the full planning pipeline with confirmation.
 *
 * @param {object} opts
 * @param {string} opts.message - The raw user message
 * @param {string} opts.userId - For LLM client resolution
 * @param {string} opts.conversationMemory - Formatted recent exchanges
 * @param {string|null} opts.treeSummary - Brief summary of current tree state
 * @param {AbortSignal} [opts.signal] - Cancellation signal
 *
 * @returns {object} { plan, responseHint, summary, confidence }
 */
export async function translateDestructive({
  message,
  userId,
  conversationMemory,
  treeSummary,
  signal,
  slot,
  rootId,
}) {
  const overrideId = rootId ? await resolveRootLlmForMode(rootId, "tree:structure") : null;
  const { client: openai, model, isCustom, connectionId, noLlm } = await getClientForUser(userId, slot, overrideId);
  if (noLlm) throw new Error("NO_LLM");
  const _llmProvider = { isCustom, model, connectionId: connectionId || null };

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
    const result = parseLlmJson(raw);
    if (!result) throw new Error("No parseable JSON found");

    // Validate structure
    if (
      !result.plan ||
      !Array.isArray(result.plan) ||
      result.plan.length === 0
    ) {
      throw new Error("Missing or empty plan");
    }

    // Ensure each plan item has required fields
    for (const op of result.plan) {
      if (!op.intent) op.intent = "query";
      if (op.needsNavigation === undefined)
        op.needsNavigation = !!op.targetHint;
      if (op.isDestructive === undefined) op.isDestructive = false;
      if (!op.directive) op.directive = message;
    }

    if (!result.responseHint) result.responseHint = "";
    if (!result.summary) result.summary = message;
    if (result.confidence === undefined) result.confidence = 0.5;

    // Clamp confidence
    result.confidence = Math.max(0, Math.min(1, result.confidence));

    result.llmProvider = _llmProvider;
    return result;
  } catch (err) {
    // If JSON parse fails, return a safe fallback
 log.error("Tree Orchestrator", " Translator parse failed:", err.message, "raw:", raw);
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
      confidence: 0.5,
      llmProvider: _llmProvider,
    };
  }
}

// Backward compat — old name still works
export { translateDestructive as translate };
