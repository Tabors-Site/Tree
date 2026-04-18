export default {
  name: "book-workspace",
  version: "0.1.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "Author books inside a tree. A book project is a node. Its children are " +
    "parts, chapters, or scenes — whichever depth the architect chose for " +
    "this book's scope. Prose lives in notes on each leaf node. When the " +
    "user wants to read the book, the existing `book` extension walks the " +
    "subtree and compiles notes into one document. book-workspace writes; " +
    "book reads. " +
    "\n\n" +
    "Five modes, one per tense. Plan for turning an idea into a TOC + " +
    "contracts (characters, setting, voice, tone) and dispatching chapter " +
    "branches. Write for prose generation inside a chapter (log-tense). " +
    "Coach for guided book development (future-tense). Review for " +
    "cross-chapter consistency audits (past-tense). Ask for read-only " +
    "queries about what's already written. " +
    "\n\n" +
    "Swarm handles the decomposition. For a short book, the architect " +
    "emits one branch per chapter. For a massive book, the architect " +
    "emits parts; each part recursively emits chapters; each chapter may " +
    "emit scenes. Depth is decided by the architect based on scope — " +
    "swarm just dispatches. The tree is the source of truth: users can " +
    "reorder chapters, rewrite scenes, insert new parts, and swarm " +
    "reconciles on next engagement. " +
    "\n\n" +
    "Contracts are the coherence mechanism. Characters, setting, POV, " +
    "tense, voice, theme, glossary — declared once at the top, read by " +
    "every chapter's enrichContext. Branches write consistent prose " +
    "without reading each other's drafts. When they need to — consistency " +
    "audit, call-back to an earlier scene — swarm's readSiblingBranches " +
    "surfaces sibling chapters as read-only summaries.",

  territory: "writing a book, TOC, chapters, scenes, prose, characters, plot, narrative, manuscript",

  vocabulary: {
    nouns: [
      /\b(book|books|novel|novella|memoir|manuscript|manuscripts|chapter|chapters|scene|scenes|part|parts|volume|volumes|prologue|epilogue|preface|introduction|conclusion)\b/i,
      /\b(character|characters|protagonist|antagonist|narrator|cast|figure|figures)\b/i,
      /\b(plot|plots|subplot|subplots|arc|arcs|beat|beats|climax|resolution|exposition|conflict)\b/i,
      /\b(setting|settings|world|worlds|worldbuilding|timeline|era|era|universe)\b/i,
      /\b(theme|themes|motif|motifs|tone|voice|POV|point\s+of\s+view|tense|register|style)\b/i,
      /\b(draft|drafts|outline|outlines|TOC|table\s+of\s+contents|synopsis|summary)\b/i,
      /\b(prose|dialogue|narrative|narration|description|passage|passages|paragraph|paragraphs)\b/i,
    ],
    verbs: [
      // Create / author verbs — cover "make", "start", "generate" etc.
      /\b(write|writing|wrote|author|authoring|authored|draft|drafting|drafted|compose|composing|composed)\b/i,
      /\b(make|making|made|create|creating|created|start|starting|started|begin|beginning|began|generate|generating|generated|produce|producing|produced|build|building|built)\b/i,
      // Plan / outline
      /\b(outline|outlining|outlined|plan|planning|planned|plot|plotting|plotted|structure|structuring|scaffold|scaffolding)\b/i,
      // Revise / edit
      /\b(revise|revising|revised|rewrite|rewriting|rewrote|edit|editing|edited|polish|polishing|redraft|redrafting)\b/i,
      // Structural operations
      /\b(chapter|chaptering|subdivide|subdividing|split|splitting|merge|merging|reorder|reordering|expand|expanding|expanded)\b/i,
      // Narrative techniques
      /\b(foreshadow|foreshadowing|callback|reference|referencing|weave|weaving|develop|developing)\b/i,
    ],
    adjectives: [
      /\b(consistent|inconsistent|coherent|incoherent|tight|loose|compelling|flat|vivid|dull)\b/i,
      /\b(first-person|third-person|omniscient|limited|close|distant|past-tense|present-tense)\b/i,
      /\b(formal|informal|lyrical|spare|ornate|dense|breezy|academic|conversational)\b/i,
    ],
  },

  classifierHints: [
    /\b(write|draft|author|compose|make|create|start|begin|generate|build|produce)\s+(?:me\s+)?(?:a\s+|the\s+|an\s+)?(book|novel|novella|chapter|memoir|story|anthology|manuscript)\b/i,
    /\b(plan|outline|structure|scaffold)\s+(?:a\s+|the\s+|my\s+)?(book|novel|manuscript|story|chapters)\b/i,
    /\b(add|insert|rewrite|revise|expand)\s+(?:a\s+|the\s+|this\s+|that\s+)?(chapter|scene|prologue|epilogue|passage)\b/i,
    /\b(reorder|swap|split|merge)\s+(?:the\s+|my\s+)?(chapters?|scenes?|parts?)\b/i,
    /\b(character|POV|voice|tone)\s+(for|of|in)\s+(?:the\s+|my\s+)?(book|novel|chapter|story)\b/i,
    /^\s*(book|novel|chapter|novella)\s+about\b/i,
  ],

  needs: {
    services: ["hooks", "metadata"],
    models: ["Node", "Note"],
  },

  optional: {
    services: ["llm"],
    extensions: ["swarm", "book", "intake", "treeos-base"],
  },

  provides: {
    models: {},
    routes: "./routes.js",
    tools: false,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    modes: [
      { key: "tree:book-plan", handler: "./modes/plan.js", assignmentSlot: "book-plan" },
      { key: "tree:book-write", handler: "./modes/write.js", assignmentSlot: "book-write" },
      { key: "tree:book-coach", handler: "./modes/coach.js", assignmentSlot: "book-coach" },
      { key: "tree:book-review", handler: "./modes/review.js", assignmentSlot: "book-review" },
      { key: "tree:book-ask", handler: "./modes/ask.js", assignmentSlot: "book-ask" },
    ],

    hooks: {
      fires: [],
      listens: [
        "enrichContext",
        "afterNote",
        "afterNodeCreate",
        "afterBoot",
        "swarm:afterProjectInit",
        "swarm:afterBranchComplete",
        "swarm:afterAllBranchesComplete",
      ],
    },
  },
};
