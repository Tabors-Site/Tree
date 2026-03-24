
import "./ExtensionsAbout.css";

const ExtensionsAbout = () => {
  return (
    <div className="ext-docs">
      <div className="ext-docs-card">

        {/* -- BACK -- */}
        <div className="al-page-back">
          <a className="al-back-link" href="/about">←</a>
        </div>

        {/* -- HEADER -- */}
        <div className="ext-header">
          <h2 className="ext-title">Extensions</h2>
          <p className="ext-subtitle">
            TreeOS is modular and extensible. The core protocol defines
            nodes, notes, types, status, and AI interaction modes. These
            are the kernel. Everything else, values, schedules, versioning,
            scripts, understanding, is an extension that can be installed,
            disabled, removed, or replaced independently.
          </p>
        </div>

        {/* -- HOW IT WORKS -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">⚙️</span> How It Works
          </div>
          <div className="ext-section-text">
            Every extension lives in its own directory with a manifest that
            declares what it needs and what it provides. The loader scans
            these manifests on boot, resolves dependencies in topological order,
            validates version constraints, and wires routes, tools, jobs,
            hooks, and models into the land automatically.
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            Extensions only receive the services they declare. If an extension
            says it needs the User model and the energy service, that's all it
            gets. Extensions communicate with each other through the
            <code> getExtension()</code> API and declared exports, never through
            direct file imports. If you uninstall one, everything that depends
            on it gracefully degrades.
          </div>
        </div>

        {/* -- FILE EXTENSION ANALOGY -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">📂</span> Think of It Like an OS
          </div>
          <div className="ext-section-text">
            In a traditional OS, you install programs that extend what the
            system can do. A fresh OS has a file manager and a terminal.
            You install a browser, a text editor, a music player. Each
            program registers its file types, adds menu entries, and
            integrates with the system.
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            TreeOS works the same way. A fresh land has nodes, notes, types,
            and AI chat. You install extensions for values, scripts, understanding
            runs, billing, Solana wallets, blog posts. Each extension registers its
            routes, models, hooks, energy costs, and CLI commands. Uninstall one
            and the rest keep running.
          </div>
        </div>

        {/* -- MANIFEST -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">📋</span> The Manifest
          </div>
          <div className="ext-section-text">
            Every extension has a <code>manifest.js</code> that declares its contract:
          </div>
          <div className="ext-code-block">{`export default {
  name: "understanding",
  version: "1.0.0",
  description: "Bottom-up tree compression with LLM summarization",

  // Required: won't load without these
  needs: {
    services: ["llm", "session", "aiChat", "orchestrator"],
    models: ["Node", "Contribution"],
    extensions: ["other-ext@^1.0.0"],  // semver constraints supported
  },

  // Optional: works without these (no-op stubs injected)
  optional: {
    services: ["energy"],
    extensions: ["gateway"],  // uses if available, skips if not
  },

  provides: {
    models: { UnderstandingRun: "./models/run.js" },
    routes: "./routes.js",
    tools: "./tools.js",
    energyActions: { understanding: { cost: 1, unit: "per-node" } },
    sessionTypes: { UNDERSTANDING: "understanding-orchestrate" },
    cli: [
      { command: "understand", description: "Start understanding run" },
    ],
  },
};`}</div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            The <code>needs</code> field lists required dependencies. If they're
            missing, the extension won't load. Version constraints
            like <code>@^1.0.0</code> are checked against installed versions.
            The <code>optional</code> field lists services and extensions that
            enhance functionality but aren't required. If the host land doesn't
            have energy, calls become silent no-ops.
          </div>
        </div>

        {/* -- INTER-EXTENSION COMMUNICATION -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🔗</span> Inter-Extension Communication
          </div>
          <div className="ext-section-text">
            Extensions never import each other's files directly. They communicate
            through declared exports and the <code>getExtension()</code> API.
          </div>
          <div className="ext-code-block">{`// Expose functions from your extension
export async function init(core) {
  return {
    router,
    exports: {
      myFunction,
      myOtherFunction,
    },
  };
}

// Use another extension's exports
import { getExtension } from "../loader.js";
const other = getExtension("other-ext");
if (other?.exports?.myFunction) {
  await other.exports.myFunction(data);
}`}</div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            This keeps extensions fully decoupled. If the other extension isn't
            installed, <code>getExtension()</code> returns null and your code
            skips the call. No crashes, no broken imports.
          </div>
        </div>

        {/* -- LIFECYCLE -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🔄</span> Lifecycle
          </div>
          <div className="ext-lifecycle">
            <div className="ext-lifecycle-step">
              <div className="ext-lifecycle-label">Search</div>
              <div className="ext-lifecycle-desc">Find extensions in the registry</div>
              <div className="ext-lifecycle-cmd">treeos ext search blog</div>
            </div>
            <div className="ext-lifecycle-arrow">→</div>
            <div className="ext-lifecycle-step">
              <div className="ext-lifecycle-label">Install</div>
              <div className="ext-lifecycle-desc">Downloads files, resolves deps, verifies checksum</div>
              <div className="ext-lifecycle-cmd">treeos ext install blog</div>
            </div>
            <div className="ext-lifecycle-arrow">→</div>
            <div className="ext-lifecycle-step">
              <div className="ext-lifecycle-label">Active</div>
              <div className="ext-lifecycle-desc">Loaded on boot, routes and tools available</div>
              <div className="ext-lifecycle-cmd">treeos ext list</div>
            </div>
          </div>
          <div className="ext-lifecycle" style={{ marginTop: 16 }}>
            <div className="ext-lifecycle-step">
              <div className="ext-lifecycle-label">Disable</div>
              <div className="ext-lifecycle-desc">Skip on next boot, files stay</div>
              <div className="ext-lifecycle-cmd">treeos ext disable blog</div>
            </div>
            <div className="ext-lifecycle-arrow">→</div>
            <div className="ext-lifecycle-step">
              <div className="ext-lifecycle-label">Enable</div>
              <div className="ext-lifecycle-desc">Load again on next boot</div>
              <div className="ext-lifecycle-cmd">treeos ext enable blog</div>
            </div>
            <div className="ext-lifecycle-arrow">→</div>
            <div className="ext-lifecycle-step">
              <div className="ext-lifecycle-label">Uninstall</div>
              <div className="ext-lifecycle-desc">Delete directory, data stays in database</div>
              <div className="ext-lifecycle-cmd">treeos ext uninstall blog</div>
            </div>
          </div>
          <div className="ext-section-text" style={{ marginTop: 16 }}>
            Dependencies are resolved automatically. Installing an extension that
            needs others will install them first. Uninstalling checks for dependents
            and warns before removing. Installs are verified with SHA256 checksums.
          </div>
        </div>

        {/* -- BUILT-IN EXTENSIONS -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">📦</span> Built-in Extensions
          </div>
          <div className="ext-section-text">
            TreeOS ships with these extensions. They're all optional. A minimal
            land runs with just the core protocol.
          </div>
          <div className="ext-grid">
            {[
              { name: "fitness", desc: "Personal fitness coaching, workout programming, and exercise tracking" },
              { name: "food", desc: "Calorie and macro tracking, meal planning, and nutritional coaching" },
              { name: "tree-orchestrator", desc: "Chat/place/query conversation AI with planning and multi-step execution" },
              { name: "html-rendering", desc: "Server-rendered HTML pages, share token auth, and page registration API for other extensions" },
              { name: "understanding", desc: "Bottom-up tree compression with LLM summarization" },
              { name: "dreams", desc: "Daily background maintenance: cleanup, drain, understand, notify" },
              { name: "raw-ideas", desc: "Unstructured capture with auto-placement pipeline" },
              { name: "gateway", desc: "External channel integration for Telegram, Discord, and web push" },
              { name: "values", desc: "Numeric values and goals on nodes with tree-wide accumulation" },
              { name: "scripts", desc: "Sandboxed JavaScript on nodes with value/goal mutation" },
              { name: "prestige", desc: "Node versioning system with archived history" },
              { name: "schedules", desc: "Date scheduling and calendar views for nodes" },
              { name: "energy", desc: "Daily energy budget with tier-based limits and metering" },
              { name: "billing", desc: "Stripe subscription tiers and energy purchases" },
              { name: "transactions", desc: "Value transactions between nodes with approval policies" },
              { name: "blog", desc: "Land-level blog for posts and updates" },
              { name: "book", desc: "Export tree notes as shareable documents" },
              { name: "solana", desc: "On-chain wallets and token operations per node" },
              { name: "shell", desc: "Execute shell commands from AI (god-tier only)" },
              { name: "land-manager", desc: "Autonomous land management agent for system operations" },
              { name: "api-keys", desc: "User-generated API keys for programmatic access" },
              { name: "user-llm", desc: "Custom LLM connections and per-user model routing" },
              { name: "user-queries", desc: "Notes, tags, contributions, chats, notifications" },
              { name: "deleted-revive", desc: "Soft delete with branch recovery" },
              { name: "email", desc: "Email verification for registration and password reset" },
              { name: "console", desc: "Colored log formatter with runtime log level control" },
            ].map((ext) => (
              <div key={ext.name} className="ext-grid-item">
                <div className="ext-grid-name">{ext.name}</div>
                <div className="ext-grid-desc">{ext.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* -- PUBLISHING -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🚀</span> Publishing
          </div>
          <div className="ext-section-text">
            Anyone running a land can publish extensions to the registry.
            The registry is decentralized: your land authenticates via Canopy
            protocol (Ed25519 signed tokens). Published extensions include
            SHA256 checksums for integrity verification. No npm account needed,
            no build step. Just write a manifest.js and index.js, and publish.
          </div>
          <div className="ext-code-block">{`treeos ext publish my-extension`}</div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            The publishing land owns the extension. Other lands on the maintainers
            list can also push updates. Only the author land can change maintainers.
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            Extensions can also be installed directly from a git repository if
            the registry entry includes a <code>repoUrl</code>. Large extensions
            use this instead of inline file storage.
          </div>
        </div>

        {/* -- BUILDING -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🔧</span> Building an Extension
          </div>
          <div className="ext-section-text">
            An extension is a directory with at minimum two files:
          </div>
          <div className="ext-file-list">
            <div className="ext-file-item">
              <code>manifest.js</code> . declares needs, provides, version
            </div>
            <div className="ext-file-item">
              <code>index.js</code> . exports <code>init(core)</code> function
            </div>
            <div className="ext-file-item">
              <code>routes.js</code> . optional, Express router for HTTP endpoints
            </div>
            <div className="ext-file-item">
              <code>core.js</code> . optional, business logic
            </div>
            <div className="ext-file-item">
              <code>model.js</code> . optional, Mongoose schema
            </div>
            <div className="ext-file-item">
              <code>tools.js</code> . optional, MCP tools for AI
            </div>
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            The <code>init(core)</code> function receives a scoped services
            bundle and returns what the loader needs to wire up:
          </div>
          <div className="ext-code-block">{`export async function init(core) {
  // Wire optional services
  if (core.energy) setEnergyService(core.energy);

  // Register hooks
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    if (meta.myData) context.myData = meta.myData;
  }, "my-extension");

  return {
    router,
    tools,
    exports: { myFunction, myOtherFunction },
    jobs: [{ name: "my-job", start: () => {}, stop: () => {} }],
  };
}`}</div>
        </div>

        {/* -- HOOKS -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🪝</span> Hooks
          </div>
          <div className="ext-section-text">
            Extensions integrate deeply through an open hook system. The kernel
            fires events when things happen (note created, status changed, node
            deleted). Extensions listen and react without the kernel knowing
            they exist. Extensions can also fire their own hooks for other
            extensions to listen to.
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            This is how energy tracks usage without being hardcoded into the
            kernel. How prestige tags version numbers without the kernel knowing
            about versions. How understanding flags dirty nodes without the
            kernel knowing about compression. Each extension hooks into the
            events it cares about and ignores everything else.
          </div>
        </div>

        {/* -- SPATIAL SCOPING -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🌍</span> Spatial Extension Scoping
          </div>
          <div className="ext-section-text">
            Any node can control which extensions are active at that position.
            Block an extension at a tree root and it disappears from the entire
            tree. Block it on a branch and only that subtree is affected. The
            extension stays installed on the land. Other trees still use it.
            Navigate somewhere and the capabilities change.
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            Three access levels per extension per node:
          </div>
          <div className="ext-file-list">
            <div className="ext-file-item">
              <code>active</code> . full access. All tools, hooks, modes, metadata. The default.
            </div>
            <div className="ext-file-item">
              <code>restricted "read"</code> . read-only tools pass. Write tools filtered out. Hooks still fire.
            </div>
            <div className="ext-file-item">
              <code>blocked</code> . nothing. No tools, no hooks, no modes, no metadata writes.
            </div>
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            This is how a Health tree has a Fitness branch and a Food branch where
            each extension can see the other's data (restricted to read) but can't
            write to it. The fitness coach can reference your nutrition while planning
            workouts, but can't create food nodes on the fitness branch.
          </div>
          <div className="ext-code-block">{`treeos cd Health/Fitness
treeos ext-restrict food read      # food can see but not write here
treeos ext-block solana            # no wallets on this branch

treeos cd Health/Food
treeos ext-restrict fitness read   # fitness can see but not write here`}</div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            Tool filtering uses the MCP <code>readOnlyHint</code> annotation that
            every tool already declares. When an extension is restricted to read,
            only its read-only tools pass through. No manual tool lists needed.
            The kernel handles it.
          </div>
        </div>

        {/* -- AI ENTRY POINTS -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">💬</span> Two AI Entry Points
          </div>
          <div className="ext-section-text">
            Every extension uses one of two core functions for AI. No manual MCP connections,
            no session management, no AIChat tracking. One call handles everything.
          </div>

          <div className="ext-section-text" style={{ marginTop: 16 }}>
            <strong>runChat</strong> . Single message, persistent session. For user-facing chat.
          </div>
          <div className="ext-code-block">{`const { answer } = await core.llm.runChat({
  userId, username,
  message: "show me land status",
  mode: "land:manager",
  rootId: null,     // for tree modes
  signal: null,     // AbortController for cancellation
});`}</div>

          <div className="ext-section-text" style={{ marginTop: 16 }}>
            <strong>OrchestratorRuntime</strong> . Multi-step chain with managed lifecycle.
            For background pipelines.
          </div>
          <div className="ext-code-block">{`const rt = new OrchestratorRuntime({
  rootId, userId, username, visitorId,
  sessionType: "my-pipeline",
  description: "Background job",
  modeKeyForLlm: "tree:analyze",
});
await rt.init("Starting pipeline");

const { parsed } = await rt.runStep("tree:analyze", {
  prompt: "Analyze this tree",
});

rt.setResult("Done", "my-pipeline:complete");
await rt.cleanup();`}</div>
        </div>

        {/* -- ORCHESTRATOR -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🧠</span> Custom Orchestrator
          </div>
          <div className="ext-section-text">
            Extensions can replace the entire conversation orchestrator. The orchestrator
            controls how chat, place, and query messages are classified, planned, and executed.
            If no extension registers one, the built-in orchestrator runs.
          </div>
          <div className="ext-code-block">{`return {
  orchestrator: {
    bigMode: "tree",
    async handle({ visitorId, message, socket, userId, ...ctx }) {
      // Full control over the AI conversation flow
    },
  },
};`}</div>
        </div>

        {/* -- HTML RENDERING INTEGRATION -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🖥️</span> Adding HTML Pages
          </div>
          <div className="ext-section-text">
            If the <code>html-rendering</code> extension is installed, any extension
            can register its own server-rendered pages and use shared render functions.
          </div>
          <div className="ext-code-block">{`import { getExtension } from "../loader.js";

export async function init(core) {
  const html = getExtension("html-rendering");

  // Register a page route
  if (html?.exports?.registerPage) {
    html.exports.registerPage("get", "/my-dashboard", (req, res) => {
      res.send("<h1>My Dashboard</h1>");
    });
  }

  // Use shared render functions
  // html?.exports?.renderValues({ ... })
  // html?.exports?.renderEnergy({ ... })
}`}</div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            If html-rendering is not installed, all routes fall back to JSON
            responses automatically. No crashes, no conditional imports needed.
          </div>
        </div>

        {/* -- API ENDPOINTS -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🌐</span> API Endpoints
          </div>
          <div className="ext-endpoint">
            <span className="ext-ep-method get">GET</span>
            <span className="ext-ep-url">/api/v1/land/extensions</span>
            <span className="ext-ep-desc">List all loaded extensions with status</span>
          </div>
          <div className="ext-endpoint">
            <span className="ext-ep-method get">GET</span>
            <span className="ext-ep-url">/api/v1/land/extensions/:name</span>
            <span className="ext-ep-desc">Get manifest details for an extension</span>
          </div>
          <div className="ext-endpoint">
            <span className="ext-ep-method post">POST</span>
            <span className="ext-ep-url">/api/v1/land/extensions/install</span>
            <span className="ext-ep-desc">Install extension from registry (checksum verified)</span>
          </div>
          <div className="ext-endpoint">
            <span className="ext-ep-method post">POST</span>
            <span className="ext-ep-url">/api/v1/land/extensions/:name/publish</span>
            <span className="ext-ep-desc">Publish local extension to registry (author + maintainers)</span>
          </div>
          <div className="ext-endpoint">
            <span className="ext-ep-method post">POST</span>
            <span className="ext-ep-url">/api/v1/land/extensions/:name/disable</span>
            <span className="ext-ep-desc">Disable extension (restart to apply)</span>
          </div>
          <div className="ext-endpoint">
            <span className="ext-ep-method post">POST</span>
            <span className="ext-ep-url">/api/v1/land/extensions/:name/enable</span>
            <span className="ext-ep-desc">Re-enable disabled extension</span>
          </div>
          <div className="ext-endpoint">
            <span className="ext-ep-method post">POST</span>
            <span className="ext-ep-url">/api/v1/land/extensions/:name/uninstall</span>
            <span className="ext-ep-desc">Remove extension directory (checks dependents, data kept)</span>
          </div>
        </div>

        {/* -- SECURITY -- */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🔒</span> Security
          </div>
          <div className="ext-section-text">
            Extensions run in the same Node.js process as the kernel. There is no
            sandbox. Manifests declare dependencies for documentation and scoped
            injection, but do not enforce access boundaries. Review all third-party
            extension code before installing.
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            Published extensions include SHA256 checksums computed from file contents.
            The installer verifies integrity before writing files. Publishing requires
            Canopy authentication (Ed25519 signed tokens). Only the author land or
            declared maintainer lands can update a published extension.
          </div>
        </div>

        {/* -- LINKS -- */}
        <div className="ext-section">
          <div className="ext-links">
            <a href="/about/api">API Reference</a>
            {" | "}
            <a href="/about/cli">CLI Guide</a>
            {" | "}
            <a href="/about/node-types">Node Types</a>
            {" | "}
            <a href="/about">About</a>
          </div>
        </div>

      </div>
    </div>
  );
};

export default ExtensionsAbout;
