// intent.js

const SIGNALS = {
  structure: {
    // Tree / structure shaping
    phrases: [
      // explicit structure
      "create a plan",
      "build a plan",
      "make a plan",
      "set up a plan",
      "new plan",

      "add a branch",
      "create a branch",
      "new branch",
      "remove a branch",
      "delete a branch",

      "add section",
      "create section",
      "new section",
      "remove section",
      "delete section",

      "add child",
      "create child",
      "add node",
      "create node",
      "new node",

      "split into",
      "break into",
      "merge into",
      "combine into",

      "move branch",
      "move section",
      "reorder",
      "rearrange",
      "reorganize",
      "restructure",

      "build out",
      "fill out",
      "flesh out",
      "lay out",
      "set up",

      "outline this",
      "structure this",
      "organize this",
    ],
    words: [
      // verbs (VERY important)
      "add",
      "create",
      "make",
      "build",
      "remove",
      "delete",
      "move",
      "split",
      "merge",
      "reorder",
      "organize",
      "structure",
      "outline",
      "expand",
      "collapse",

      // nouns
      "plan",
      "section",
      "branch",
      "node",
      "child",
      "children",
      "parent",
      "tree",
      "hierarchy",
    ],
  },

  edit: {
    // Content changes inside a node
    phrases: [
      "add note",
      "create note",
      "new note",
      "edit note",
      "update note",
      "change note",
      "remove note",
      "delete note",

      "add value",
      "set value",
      "update value",
      "change value",
      "remove value",

      "rename",
      "rename this",
      "change name",
      "update name",

      "fix typo",
      "correct typo",
      "fix spelling",
      "clean this up",

      "rewrite this",
      "reword this",
      "rephrase this",
    ],
    words: [
      // verbs
      "edit",
      "change",
      "update",
      "rewrite",
      "reword",
      "rephrase",
      "fix",
      "correct",
      "rename",
      "delete",
      "remove",

      // nouns
      "note",
      "notes",
      "value",
      "values",
      "text",
      "content",
      "name",
      "title",
      "description",
      "label",
      "typo",
    ],
  },

  reflect: {
    // Read-only, explicit curiosity
    starters: [
      "what is",
      "what are",
      "what's",
      "tell me about",
      "explain",
      "describe",
      "show me",
      "how does",
      "why does",
      "can you explain",
      "what does this",
    ],
    phrases: [
      "overview",
      "summary",
      "review",
      "understand",
      "walk me through",
      "give me context",
    ],
    words: [],
  },
};

const NEGATIONS = /\b(don't|dont|do not|doesn't|never|not|no)\b/i;

// ---------------- helpers ----------------

function scoreIntent(message, signals = {}) {
  let score = 0;

  if (signals.phrases) {
    for (const phrase of signals.phrases) {
      if (message.includes(phrase)) score += 3;
    }
  }

  if (signals.starters) {
    for (const starter of signals.starters) {
      if (message.startsWith(starter)) {
        score += 3;
        break;
      }
    }
  }

  if (signals.words) {
    for (const word of signals.words) {
      const regex = new RegExp(`\\b${word}\\b`, "i");
      if (regex.test(message)) score += 1;
    }
  }

  return score;
}

function getNonZeroIntents(scores) {
  return Object.entries(scores).filter(([, score]) => score > 0);
}

function isActionableQuestion(text) {
  return [
    /what (should|can|could) i (add|create|change|update|edit)/i,
    /how (should|can|could) i (add|create|change|update|organize)/i,
    /where (should|can|could) i (add|create|put)/i,
    /help me (add|create|organize|structure)/i,
  ].some((pattern) => pattern.test(text));
}

// ---------------- main ----------------

export function determineIntent({ message, currentMode }) {
  if (!message) return { action: "stay", confidence: 0 };

  const text = message.toLowerCase().trim();

  // Soft negation guard
  if (
    NEGATIONS.test(text) &&
    !/(add|edit|rename|create|restructure|organize|structure)/i.test(text)
  ) {
    return { action: "stay", confidence: 0, reason: "negation" };
  }

  const scores = {
    structure: scoreIntent(text, SIGNALS.structure),
    edit: scoreIntent(text, SIGNALS.edit),
    reflect: scoreIntent(text, SIGNALS.reflect),
  };

  const nonZero = getNonZeroIntents(scores);

  // Cancel reflect if question implies action
  if (scores.reflect > 0 && isActionableQuestion(text)) {
    scores.reflect = 0;
  }

  // ---- EDIT (highest priority) ----
  if (scores.edit >= 2 || (scores.edit > 0 && nonZero.length === 1)) {
    const targetMode = "tree:edit";
    if (currentMode === targetMode) {
      return { action: "stay", confidence: scores.edit };
    }
    return { action: "switch", targetMode, confidence: scores.edit };
  }

  // ---- STRUCTURE ----
  if (scores.structure >= 2 || (scores.structure > 0 && nonZero.length === 1)) {
    const targetMode = "tree:structure";
    if (currentMode === targetMode) {
      return { action: "stay", confidence: scores.structure };
    }
    return { action: "switch", targetMode, confidence: scores.structure };
  }

  // ---- REFLECT (explicit only) ----
  if (scores.reflect >= 3) {
    const targetMode = "tree:reflect";
    if (currentMode === targetMode) {
      return { action: "stay", confidence: scores.reflect };
    }
    return { action: "switch", targetMode, confidence: scores.reflect };
  }

  return {
    action: "stay",
    confidence: 0,
    reason: "no_clear_intent",
  };
}
