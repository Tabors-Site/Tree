// orchestrators/translator.js
// Translates natural user language into tree operations using the Tree Constitution.
// Sits between user input and the tree orchestrator.

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { getClientForUser, resolveRootLlmForMode } from "../ws/conversation.js";

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
YOUR TASK
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
${CONSTITUTION}

────────────────────────────────────────────────────────
YOUR TASK
────────────────────────────────────────────────────────

You receive a thought, idea, or request along with the current tree state.
Your ONLY job is to classify what kind of action this requires.

Return ONLY this JSON. No markdown. No explanation.

{
  "intent": "place" | "query" | "destructive" | "defer" | "no_fit",
  "confidence": number,
  "responseHint": string,
  "summary": string,
  "placementAxes": {
    "pathConfidence": number,
    "domainNovelty": number,
    "relationalComplexity": number
  } | null
}

INTENT DEFINITIONS:

"place" — The user has a thought, idea, fact, or piece of information that
  should be stored on the tree. This includes:
  - Notes, observations, preferences ("flights are cheaper in March")
  - New things to track ("add a workout routine")
  - Information to file ("fix bug where user can't respond")
  - Building new structure ("add a section for travel tips")
  The librarian will handle finding the right place and storing it.

"query" — The user is asking a question or wants to understand something.
  No tree modifications needed. Examples:
  - "what should I do next?"
  - "hey, what's going on with this?"
  - "how's the budget looking?"
  - Greetings, thanks, conversational messages
  The librarian will read the tree and gather context to answer.

"destructive" — The user wants to DELETE, MOVE, MERGE, REORGANIZE, or
  make STATUS CHANGES. These are dangerous operations that need the
  full planning pipeline with confirmation. Examples:
  - "delete the old workout branch"
  - "merge these two nodes"
  - "remove what doesn't belong"
  - "move Backend under Projects"
  - "mark everything as complete"

"defer" — The user explicitly wants to hold this idea for later rather than
  place it now. They're saying "save this", "defer this", "hold this",
  "remember this for later", "park this", etc. The content still belongs
  on the tree, but the user wants it held in short-term memory.
  Set placementAxes to null for defer.

"no_fit" — The idea has NO meaningful connection to this tree's domain.
  A dentist appointment doesn't belong in a Japan Trip tree.
  Only use for genuinely unrelated content.

CONFIDENCE:
  1.0 = obviously belongs (e.g., "add pushups" on Fitness tree)
  0.7 = reasonable fit
  0.3 = stretch, vaguely related
  0.0 = no_fit

RESPONSE HINT:
  Guidance for how the response should feel. Match the user's energy.
  Brief input → brief hint. Big request → richer hint.

SUMMARY:
  One-line description for logs.

PLACEMENT AXES (required when intent is "place", null otherwise):

When intent is "place", you MUST also return placementAxes to help the system
decide whether to place immediately or hold the idea for more context.

  pathConfidence (0.0–1.0): Can this resolve to a SPECIFIC EXISTING node?
    0.9 = exact match exists ("add pushups" when a Pushups node is already there).
    0.5 = a related branch exists but the exact spot is unclear.
    0.2 = no obvious home — would need new structure to place this well.
    1.0 = user explicitly says "create/build/plan X" — explicit structural
    intent with a clear directive, always place immediately.
    IMPORTANT: Do NOT give high pathConfidence just because you could
    create a new branch. High pathConfidence means the spot ALREADY EXISTS.

  domainNovelty (0.0–1.0): Is this a genuinely new top-level area for this tree?
    0.9 = brand new domain not represented anywhere. 0.1 = fits existing branches.

  relationalComplexity (0.0–1.0): Does this touch or imply a link between two+
    existing subtrees? 0.8 = "my diet affects my workout output" bridges
    diet + workout branches. 0.1 = clearly about a single branch.

When intent is NOT "place" (including "defer"), set placementAxes to null.

RULES:
1. ALWAYS return valid JSON. Nothing else.
2. When in doubt between "place" and "query", lean toward "place"
   if the message contains any information worth storing.
3. "destructive" is for deletions, moves, merges, status cascades,
   and bulk changes. Edits to values/goals/names are "place".
4. no_fit means ZERO connection to this tree. A stretch is still "place"
   with low confidence, not no_fit.
5. Conversational messages ("hi", "thanks", "what's up") are "query".
6. Explicit structural intent ("I want to create a workout plan",
   "build me a project tracker") is always "place" with pathConfidence=1.0.
   The user is handing you the structure directly — never defer this.
7. Casual thoughts, observations, and fragments ("thinking about starting
   health stuff", "ate a steak today") should get LOW pathConfidence
   unless there's a clear existing node to attach them to. These are
   better held in short-term memory until the tree has enough structure.
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
    console.error("❌ Classifier parse failed:", err.message, "raw:", raw);
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
      confidence: 0.5,
      llmProvider: _llmProvider,
    };
  }
}

// Backward compat — old name still works
export { translateDestructive as translate };
