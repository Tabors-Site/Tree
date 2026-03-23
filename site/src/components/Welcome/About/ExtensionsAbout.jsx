
import "./ExtensionsAbout.css";

const ExtensionsAbout = () => {
  return (
    <div className="ext-docs">
      <div className="ext-docs-card">

        {/* ── BACK ── */}
        <div className="al-page-back">
          <a className="al-back-link" href="/about">←</a>
        </div>

        {/* ── HEADER ── */}
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

        {/* ── HOW IT WORKS ── */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">⚙️</span> How It Works
          </div>
          <div className="ext-section-text">
            Every extension lives in its own directory with a manifest that
            declares what it needs and what it provides. The loader scans
            these manifests on boot, validates dependencies, and wires
            routes, tools, jobs, and models into the land automatically.
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            Extensions only receive the services they declare. If an extension
            says it needs the User model and the energy service, that's all it
            gets. It cannot access the orchestrator, LLM routing, or any other
            service it didn't ask for. This is the permission boundary.
          </div>
        </div>

        {/* ── FILE EXTENSION ANALOGY ── */}
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
            routes, models, hooks, energy costs, and CLI commands.
          </div>
        </div>

        {/* ── MANIFEST ── */}
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
  },

  // Optional: works without these (no-op stubs injected)
  optional: {
    services: ["energy"],
  },

  provides: {
    models: { UnderstandingRun: "./models/run.js" },
    routes: "./routes.js",
    tools: "./tools.js",
    jobs: "./job.js",
    energyActions: { understanding: { cost: 1, unit: "per-node" } },
    sessionTypes: { UNDERSTANDING: "understanding-orchestrate" },
    cli: [
      { command: "understand", description: "Start understanding run" },
    ],
  },
};`}</div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            The <code>needs</code> field lists required dependencies. If they're
            missing, the extension won't load. The <code>optional</code> field
            lists services that enhance the extension but aren't required. If
            the host land doesn't have energy, the extension still works. Energy
            calls become silent no-ops.
          </div>
        </div>

        {/* ── LIFECYCLE ── */}
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
              <div className="ext-lifecycle-desc">Pull from registry, write files to land</div>
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
        </div>

        {/* ── BUILT-IN EXTENSIONS ── */}
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
              { name: "understanding", desc: "Bottom-up tree compression with LLM summarization" },
              { name: "scripts", desc: "Sandboxed JavaScript on nodes with value/goal mutation" },
              { name: "prestige", desc: "Node versioning system with archived history" },
              { name: "schedules", desc: "Date scheduling and calendar views for nodes" },
              { name: "values", desc: "Numeric values and goals on nodes with tree-wide accumulation" },
              { name: "energy", desc: "Daily energy budget with tier-based limits" },
              { name: "billing", desc: "Stripe subscription tiers and energy purchases" },
              { name: "raw-ideas", desc: "Unstructured capture with auto-placement pipeline" },
              { name: "dreams", desc: "Daily background maintenance: cleanup, drain, understand" },
              { name: "transactions", desc: "Value transactions between nodes with approval policies" },
              { name: "blog", desc: "Land-level blog for posts and updates" },
              { name: "book", desc: "Export tree notes as shareable documents" },
              { name: "solana", desc: "On-chain wallets and token operations per node" },
              { name: "api-keys", desc: "User-generated API keys for programmatic access" },
              { name: "user-llm", desc: "Custom LLM connections and per-user model routing" },
              { name: "user-queries", desc: "Notes, tags, contributions, chats, notifications" },
              { name: "deleted-revive", desc: "Soft delete with branch recovery" },
              { name: "visibility", desc: "Public/private tree toggle and share tokens" },
              { name: "html-rendering", desc: "Server-rendered HTML pages via ?html parameter" },
            ].map((ext) => (
              <div key={ext.name} className="ext-grid-item">
                <div className="ext-grid-name">{ext.name}</div>
                <div className="ext-grid-desc">{ext.desc}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── PUBLISHING ── */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🚀</span> Publishing
          </div>
          <div className="ext-section-text">
            Anyone running a land can publish extensions to the registry.
            Other lands can search, install, and use them. The registry
            stores extension files and manifests. No npm account needed,
            no build step. Just write a manifest.js and index.js,
            and publish.
          </div>
          <div className="ext-code-block">{`treeos ext publish my-extension`}</div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            Published extensions appear in the registry. Other land operators
            can find them with <code>treeos ext search</code> and install with
            <code> treeos ext install</code>.
          </div>
        </div>

        {/* ── BUILDING ── */}
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
              <code>routes.js</code> . optional, Express router factory
            </div>
            <div className="ext-file-item">
              <code>core.js</code> . optional, business logic
            </div>
            <div className="ext-file-item">
              <code>model.js</code> . optional, Mongoose schema
            </div>
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            The <code>init(core)</code> function receives a scoped services
            bundle and returns what the loader needs to wire up:
          </div>
          <div className="ext-code-block">{`export async function init(core) {
  return {
    router: createRouter(core),
    models: { MyModel },
    tools: getTools(core),
    exports: { myFunction },
  };
}`}</div>
        </div>

        {/* ── HOOKS ── */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🪝</span> Lifecycle Hooks
          </div>
          <div className="ext-section-text">
            Extensions can register hooks to modify or react to core operations
            without core knowing about them. This is how extensions integrate
            deeply without coupling. Hooks are registered during <code>init(core)</code>.
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            <strong>Before hooks</strong> run before the operation. They can modify
            the data (e.g. set a version number) or cancel it (return false or throw).
            <strong> After hooks</strong> run in parallel after the operation completes.
            They cannot block or cancel.
            <strong> enrichContext</strong> runs during AI context building and lets
            extensions inject their data so the agent sees it.
          </div>
          <div className="ext-code-block">{`// In your extension's init(core):
core.hooks.register("beforeNote", async (data) => {
  // Modify the note before it saves
  // e.g. prestige tags the version number
  data.version = getCurrentPrestigeLevel(data.nodeId);
}, "my-extension");

core.hooks.register("enrichContext", async ({ context, node, meta }) => {
  // Add your extension's data to AI context
  // so agents see it without core knowing about you
  if (meta.myData) context.myData = meta.myData;
}, "my-extension");`}</div>

          <div className="ext-section-text" style={{ marginTop: 16 }}>
            Available hooks:
          </div>
          <div className="ext-file-list">
            <div className="ext-file-item">
              <code>beforeNote</code> . before note creation. Modify version, content, or cancel.
            </div>
            <div className="ext-file-item">
              <code>afterNote</code> . after note saved. React (e.g. flag node as dirty).
            </div>
            <div className="ext-file-item">
              <code>beforeContribution</code> . before audit log. Modify nodeVersion.
            </div>
            <div className="ext-file-item">
              <code>afterNodeCreate</code> . after node created. Initialize extension data.
            </div>
            <div className="ext-file-item">
              <code>beforeStatusChange</code> . before status write. Validate or cancel.
            </div>
            <div className="ext-file-item">
              <code>afterStatusChange</code> . after status saved. React (e.g. clear schedule).
            </div>
            <div className="ext-file-item">
              <code>beforeNodeDelete</code> . before soft delete. Cleanup extension data.
            </div>
            <div className="ext-file-item">
              <code>enrichContext</code> . during AI context build. Inject extension data.
            </div>
          </div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            All handlers have a 5 second timeout. One handler per extension per hook.
            Before hooks that throw cancel the operation. After hooks run in parallel
            and never block.
          </div>
        </div>

        {/* ── ORCHESTRATOR ── */}
        <div className="ext-section">
          <div className="ext-section-title">
            <span className="ext-section-icon">🧠</span> Custom Orchestrator
          </div>
          <div className="ext-section-text">
            Extensions can replace the entire conversation orchestrator. The orchestrator
            controls how chat, place, and query messages are classified, planned, and executed.
            If no extension registers one, the built-in orchestrator runs.
          </div>
          <div className="ext-code-block">{`// In your extension's init(core):
return {
  orchestrator: {
    bigMode: "tree",
    async handle({ visitorId, message, socket, userId, ...ctx }) {
      // Full control over the AI conversation flow
      // Use core.conversation.processMessage() for LLM calls
      // Use core.orchestrator.OrchestratorRuntime for background jobs
      // Return { response, navigatedTo, ... }
    },
  },
};`}</div>
          <div className="ext-section-text" style={{ marginTop: 12 }}>
            This is how you build a completely custom AI experience.
            A food tracker that knows about nutrition. A code review agent
            with specialized intent classification. A debate system with
            multi-agent orchestration. All without touching core.
          </div>
        </div>

        {/* ── API ENDPOINTS ── */}
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
            <span className="ext-ep-desc">Install extension from registry data</span>
          </div>
          <div className="ext-endpoint">
            <span className="ext-ep-method post">POST</span>
            <span className="ext-ep-url">/api/v1/land/extensions/:name/publish</span>
            <span className="ext-ep-desc">Publish local extension to registry</span>
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
            <span className="ext-ep-desc">Remove extension directory (data kept)</span>
          </div>
        </div>

        {/* ── LINKS ── */}
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
