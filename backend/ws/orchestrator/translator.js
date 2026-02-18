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

User: "I want to plan a trip to Japan"
→ {
    "plan": [
      {
        "intent": "structure",
        "targetHint": null,
        "directive": "Create a new branch 'Japan Trip' under root with children: Flights, Accommodation, Budget, Itinerary, Packing",
        "needsNavigation": false,
        "isDestructive": false
      }
    ],
    "responseHint": "Confirm the planning tree was created. Offer to dive into any section first. Be enthusiastic but not overwhelming.",
    "summary": "Create Japan Trip planning tree"
  }

User: "the budget should be around $3000"
(conversation context: user was just talking about Japan Trip)
→ {
    "plan": [
      {
        "intent": "edit",
        "targetHint": "Budget",
        "directive": "Set value 'dollars' to 3000 on the Budget node",
        "needsNavigation": true,
        "isDestructive": false
      },
      {
        "intent": "notes",
        "targetHint": "Budget",
        "directive": "Create note: 'Rough target is around $3000 total'",
        "needsNavigation": true,
        "isDestructive": false
      }
    ],
    "responseHint": "Confirm the budget was set. Brief and natural.",
    "summary": "Set budget value and note on Budget node"
  }

User: "I just realized I need to get a rail pass"
(tree has Japan Trip > Itinerary, Flights, etc.)
→ {
    "plan": [
      {
        "intent": "notes",
        "targetHint": "Itinerary",
        "directive": "Create note on Itinerary node: 'Need to get a Japan Rail Pass — look into 7-day vs 14-day options'",
        "needsNavigation": true,
        "isDestructive": false
      }
    ],
    "responseHint": "Acknowledge the thought was captured. Maybe mention that rail passes are usually cheaper to buy in advance.",
    "summary": "Add rail pass note to Itinerary"
  }

User: "what does my tree look like right now?"
→ {
    "plan": [
      {
        "intent": "query",
        "targetHint": null,
        "directive": "Read the full tree structure from root with children and notes summary",
        "needsNavigation": false,
        "isDestructive": false
      }
    ],
    "responseHint": "Give a clear overview of the tree structure. Mention what sections have content and which are still empty.",
    "summary": "Query full tree overview"
  }

User: "actually let's scrap the packing section"
→ {
    "plan": [
      {
        "intent": "structure",
        "targetHint": "Packing",
        "directive": "Delete the Packing node",
        "needsNavigation": true,
        "isDestructive": true
      }
    ],
    "responseHint": "Confirm the section was removed. Keep it light.",
    "summary": "Delete Packing branch"
  }

User: "hmm what am I forgetting"
→ {
    "plan": [
      {
        "intent": "reflect",
        "targetHint": null,
        "directive": "Analyze the full tree for gaps, missing areas, and things commonly needed for this type of plan",
        "needsNavigation": false,
        "isDestructive": false
      }
    ],
    "responseHint": "Think about what's commonly needed for this type of plan that isn't in the tree yet. Be helpful but not pushy — suggest, don't dictate.",
    "summary": "Reflect on tree completeness"
  }

User: "hi" / "hey what's up" / "hello"
→ {
    "plan": [
      {
        "intent": "query",
        "targetHint": null,
        "directive": "No specific operation. Greet the user and offer help based on current tree state.",
        "needsNavigation": false,
        "isDestructive": false
      }
    ],
    "responseHint": "Warm, brief greeting. If there's an active tree, mention what they were working on. If not, ask what they'd like to work on.",
    "summary": "Greeting"
  }

────────────────────────────────────────────────────────
RULES
────────────────────────────────────────────────────────

1. ALWAYS return valid JSON. Nothing else.
2. plan usually has 1 item. Only use multiple when the user's request
   naturally decomposes into 2-3 distinct operations (like set a value AND add a note).
   Never more than 3 operations in one plan.
3. directive must be specific enough for the execution engine to act without
   guessing. Include node names, values, note content.
4. If the user's message is conversational (greeting, thanks, chit-chat),
   use intent "query" with a directive indicating no tree operation needed.
5. For ambiguous messages, prefer the simplest interpretation.
   "Add something about food" → one note, not a whole branch.
6. needsNavigation = true whenever targetHint is set and we need to find
   that node. false when operating on root or when no target needed.
7. responseHint should guide tone and content, not dictate exact words.
8. Match the user's language level. If they say "toss in a note," your
   directive should still be precise, but responseHint should be casual.
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
