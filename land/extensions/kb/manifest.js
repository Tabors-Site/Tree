export default {
  name: "kb",
  version: "1.0.2",
  builtFor: "TreeOS",
  description:
    "Knowledge base. Tell it things. Ask it things. One person maintains, " +
    "everyone benefits. The tree organizes input into a topic hierarchy. " +
    "The AI answers from stored notes with citations. Staleness detection " +
    "flags notes that haven't been updated. Unplaced node catches what the " +
    "AI can't categorize yet. Two modes: kb-tell (create knowledge), " +
    "kb-ask (retrieve with citations). Type 'be' for a guided review " +
    "of stale notes. The tree that replaces wikis, training manuals, " +
    "and the coworker who always gets interrupted.",

  territory: "storing and retrieving knowledge, references, notes",

  // Territory vocabulary split by part of speech.
  //
  // Philosophy: KB is unusual because its territory isn't about things in
  // the world. It's about the ACT of storing and retrieving knowledge.
  // The vocabulary is mostly meta-actions: "remember this", "what does kb
  // say", "document this". These are soft signals because phrases like
  // "remember this moment" aren't KB intent.
  //
  // The minimum routing threshold (4) protects against single soft verb
  // matches. A stray "remember" by itself (score 2) won't commit to KB
  // unless the user is at a KB tree (locality 4x = 8, passes threshold).
  //
  // Strong KB signals are direct references (kb, wiki) and document-type
  // nouns (procedure, protocol, FAQ, documentation).
  vocabulary: {
    verbs: [
      // Direct KB commands
      /\b(tell\s+kb|ask\s+kb|save\s+(?:this|that)?\s*to\s+kb|add\s+to\s+kb|store\s+in\s+kb|search\s+kb|query\s+kb)\b/i,
      // Knowledge capture phrases (soft signals)
      /\b(remember\s+(?:this|that|the\s+following))\b/i,
      /\b(note\s+(?:that|this)|write\s+(?:this|that)\s+down|document\s+(?:this|that))\b/i,
      /\b(record\s+(?:this|that|for\s+future))\b/i,
      // Knowledge retrieval phrases
      /\b(look\s+up|search\s+for|find\s+info(?:rmation)?\s+(?:on|about)|what\s+do\s+we\s+know\s+about|what\s+does\s+(?:the\s+)?kb\s+say)\b/i,
      // Update announcement verbs
      /\b(fyi|heads\s+up|update:|updated\s+to|changed\s+to|revised\s+to|the\s+procedure\s+changed)\b/i,
    ],
    nouns: [
      // Direct KB references
      /\b(kb|knowledge\s*base|wiki|wikipedia[- ]style)\b/i,
      // Document types (strong signals)
      /\b(procedure|procedures|protocol|protocols|policy|policies|manual|manuals|guide|guides|howto|how[- ]to)\b/i,
      /\b(documentation|docs|reference\s+(?:doc|material|guide)|faq|faqs)\b/i,
      /\b(handbook|handbooks|playbook|playbooks|runbook|runbooks|checklist|checklists)\b/i,
      // Procedural phrases (paired form avoids generic "process" hijack)
      /\bsteps\s+(?:for|to)\b/i,
      /\b(process\s+for|process\s+of)\b/i,
      // Knowledge items
      /\b(article|articles|entry|entries|topic|topics|knowledge\s+item)\b/i,
    ],
    adjectives: [
      // Knowledge quality states
      /\b(outdated|stale|out[- ]of[- ]date|up[- ]to[- ]date|current|verified|unverified|canonical|authoritative|deprecated|archived)\b/i,
    ],
  },

  needs: {
    models: ["Node", "Note"],
    services: ["hooks", "llm", "metadata"],
  },

  optional: {
    extensions: [
      "understanding",
      "tree-compress",
      "scout",
      "embed",
      "explore",
      "competence",
      "contradiction",
      "purpose",
      "prestige",
      "values",
      "channels",
      "breath",
      "html-rendering",
      "treeos-base",
    ],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    modes: true,
    guidedMode: "tree:kb-review",

    hooks: {
      fires: [],
      listens: ["enrichContext", "breath:exhale"],
    },

    cli: [
      {
        command: "kb [action] [message...]",
        scope: ["tree"],
        description: "Knowledge base. Tell or ask.",
        method: "POST",
        endpoint: "/root/:rootId/kb",
        body: ["message"],
        subcommands: {
          status: {
            method: "GET",
            endpoint: "/root/:rootId/kb/status",
            description: "Coverage, freshness, unplaced count.",
          },
          stale: {
            method: "GET",
            endpoint: "/root/:rootId/kb/stale",
            description: "Notes not updated in 90+ days.",
          },
          unplaced: {
            method: "GET",
            endpoint: "/root/:rootId/kb/unplaced",
            description: "Items that couldn't be categorized.",
          },
        },
      },
    ],
  },
};
