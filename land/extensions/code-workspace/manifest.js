export default {
  name: "code-workspace",
  version: "0.1.0",
  builtFor: "TreeOS",
  scope: "confined",
  description:
    "Author JavaScript projects inside a tree. A project is a node. Its children are " +
    "directories and files. File content lives in notes. When the AI writes code, it " +
    "writes nodes and notes — the tree is the source of truth. A depth-first walker " +
    "compiles the subtree into real files on disk when you sync, run, or test. Every " +
    "edit respects position, spatial scoping, cascade, and the grammar pipeline. " +
    "\n\n" +
    "Four modes, one per tense. Plan for imperative structural work (create files, " +
    "refactor). Log for present-tense incremental adds (one small change). Coach for " +
    "future-tense guidance and diagnosis (help, debug, walk me through). Ask for past " +
    "and query-tense read-only exploration (what does this do, where is X, how does " +
    "this fit together). " +
    "\n\n" +
    "Confined: inactive until `ext-allow code-workspace` at a tree root. Spatial scope " +
    "propagates the allow down. Tools are node, npm, npx, git, and anything under " +
    "<workspace>/node_modules/.bin/. Everything else is rejected." +
    "\n\n" +
    "Live preview: spawns `node <file>` children on a secondary HTTP port (default 3100) " +
    "and proxies /preview/<slug>/* to them. Projects with only an index.html are served " +
    "statically without a child process. A Run/Stop button and iframe appear on the tree " +
    "root page via the tree-owner-sections slot. Auto idle shutdown after 10 minutes.",

  territory: "writing code, building projects, refactoring, running tests, authoring JavaScript",

  // Territory vocabulary for the routing index. Nouns weigh 3x, verbs 2x,
  // adjectives 1x. Plus a 4x locality bonus when the user is inside the
  // workspace's subtree. Together this makes "write a function that..."
  // dominate routing against general-purpose domains.
  vocabulary: {
    nouns: [
      // Code things
      /\b(function|functions|method|methods|class|classes|component|components|hook|hooks|module|modules|file|files|directory|directories|folder|folders|import|imports|export|exports|variable|variables|constant|constants|parameter|parameters|argument|arguments|callback|promise|async|await)\b/i,
      // Projects and packages
      /\b(project|projects|codebase|repo|repository|package|packages|bundle|build|workspace|library)\b/i,
      // JS/TS ecosystem
      /\b(javascript|typescript|js|ts|jsx|tsx|node|npm|npx|eslint|prettier|tsc|vite|esbuild|webpack|rollup|vitest|jest|mocha)\b/i,
      // Files by name pattern
      /\b(index\.js|index\.ts|package\.json|tsconfig|manifest\.js|readme|lib\.js|main\.js|app\.js|server\.js|test\.js|\.test\.)\b/i,
      // Testing vocabulary
      /\b(test|tests|spec|specs|assertion|assertions|fixture|fixtures|mock|mocks|stub|stubs|unit\s+test|integration\s+test)\b/i,
      // Bugs and quality
      /\b(bug|bugs|error|errors|exception|exceptions|stack\s+trace|regression|crash|leak|deadlock|race\s+condition)\b/i,
    ],
    verbs: [
      // Create / write verbs
      /\b(write|writing|wrote|create|creates|creating|created|make|makes|making|made|add|adds|adding|added|scaffold|scaffolding|generate|generating)\b/i,
      // Edit / transform verbs
      /\b(refactor|refactoring|refactored|rename|renames|renaming|renamed|move|moves|moving|moved|replace|replacing|replaced|rewrite|rewriting|rewrote|patch|patching)\b/i,
      // Fix / debug verbs
      /\b(fix|fixes|fixing|fixed|debug|debugging|debugged|diagnose|diagnosing|trace|tracing|troubleshoot)\b/i,
      // Run / build / test verbs
      /\b(run|runs|running|ran|build|builds|building|built|compile|compiles|compiling|compiled|test|tests|testing|tested|lint|linting|linted|format|formatting|formatted|bundle|bundling)\b/i,
      // Install / setup verbs
      /\b(install|installs|installing|installed|setup|set\s+up|configure|configuring|configured|init|initialize|initializing)\b/i,
      // Implement / architect verbs
      /\b(implement|implements|implementing|implemented|design|designing|designed|architect|architecting|structure|structuring)\b/i,
      // Review / audit / inspect verbs (route to code-review mode via past tense)
      /\b(review|reviews|reviewing|reviewed|audit|audits|auditing|audited|inspect|inspects|inspecting|inspected|analyze|analyzes|analyzing|analyzed|check|checks|checking|checked|critique|critiques|critiquing|critiqued|assess|assesses|assessing|assessed|evaluate|evaluates|evaluating|evaluated)\b/i,
      // Explore / explain verbs (route to code-ask)
      /\b(explain|explains|explaining|explained|explore|explores|exploring|explored|understand|understands|understanding|understood|describe|describes|describing|described)\b/i,
    ],
    adjectives: [
      /\b(broken|failing|buggy|slow|fast|synchronous|asynchronous|pure|impure|mutable|immutable|stateless|stateful|reusable|duplicated|dead|unused|unreachable|circular)\b/i,
      /\b(typed|untyped|strict|loose|tested|untested|covered|uncovered|deprecated|experimental|stable)\b/i,
    ],
  },

  classifierHints: [
    /\b(write|build|create|make|add)\s+(?:me\s+)?(?:a\s+|an\s+|the\s+)?(function|class|component|module|file|helper|test|script)\b/i,
    /\b(refactor|rename|move)\s+(?:this|that|the|my)\b/i,
    /\b(fix|debug|diagnose)\s+(?:the|this|that|my)?\s*(bug|error|crash|test|function|code)\b/i,
    /\b(run|execute)\s+(?:the\s+)?(tests?|build|lint|script)\b/i,
    /\b(review|audit|inspect|analyze|check|critique)\s+(?:the\s+|this\s+|that\s+|my\s+)?\s*(code|function|class|module|file|project|changes?|diff)?\b/i,
    /\b(review|look at|check|audit)\s+this\b/i,
  ],

  needs: {
    services: ["hooks", "metadata", "tree"],
    models: ["Node", "Note"],
    extensions: ["governing"],
  },

  optional: {
    services: ["llm", "websocket"],
    extensions: ["codebase", "book", "approve", "swarm"],
  },

  provides: {
    models: {},
    routes: "./serve/routes.js",
    tools: true,
    jobs: false,
    energyActions: {},
    sessionTypes: {},
    env: [],
    cli: [],

    hooks: {
      fires: [],
      listens: [
        "enrichContext",
        "afterBoot",
        "afterNote",
        "afterSessionEnd",
        "onCascade",
        "swarm:afterProjectInit",
        "swarm:afterBranchComplete",
        "swarm:afterAllBranchesComplete",
        "swarm:runScouts",
      ],
    },

    modes: [
      { key: "tree:code-plan", handler: "./modes/plan.js", assignmentSlot: "code-plan" },
      { key: "tree:code-log", handler: "./modes/log.js", assignmentSlot: "code-log" },
      { key: "tree:code-coach", handler: "./modes/coach.js", assignmentSlot: "code-coach" },
      { key: "tree:code-ask", handler: "./modes/ask.js", assignmentSlot: "code-ask" },
      { key: "tree:code-review", handler: "./modes/review.js", assignmentSlot: "code-review" },
    ],
  },
};
