import "./LandingPage.css";
import Particles from "./Particles.jsx";

const BuildPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "50vh"}}>
        <Particles count={25} />
        <div className="lp-hero-inner">
          <h1 className="lp-title">Build Extensions</h1>
          <p className="lp-subtitle">The developer reference.</p>
          <p className="lp-tagline">
            Everything you need to build, test, and publish extensions for the seed.
            Code-first. Copy-pasteable. Each section is self-contained.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/extensions">Concepts</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Full Guide</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
          </div>
        </div>
      </section>

      {/* ── 1. QUICK START ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Quick Start</h2>
          <P>Two files. One restart. Your extension is live.</P>
          <Code>{`// extensions/my-ext/manifest.js
export default {
  name: "my-ext",
  version: "1.0.0",
  description: "My first extension",
  needs: {
    services: ["hooks"],
    models: ["Node"],
  },
  provides: {},
};`}</Code>
          <Code>{`// extensions/my-ext/index.js
export async function init(core) {
  core.hooks.register("afterNote", async ({ note, nodeId }) => {
    console.log("Note written at", nodeId);
  }, "my-ext");

  return {};
}`}</Code>
          <P>Restart the land. Your extension loads. The hook fires on every note write.</P>
        </div>
      </section>

      {/* ── 2. THE MANIFEST ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The Manifest</h2>
          <P>
            <code>manifest.js</code> declares what your extension needs and what it provides.
            The loader reads it before calling any code. Unmet needs = extension skipped.
          </P>

          <h3 style={{color: "#fff", marginTop: 32}}>needs.services</h3>
          <P>
            The loader scopes <code>core</code> to only what you declare.
            <code> hooks</code> and <code>modes</code> are always available. Everything else
            must be listed or it's <code>undefined</code>.
          </P>
          <div style={{fontSize: "0.8rem", marginBottom: 24}}>
            {[
              ["contributions", "logContribution, contribution queries"],
              ["auth", "resolveTreeAccess, registerStrategy"],
              ["protocol", "sendOk, sendError, ERR, WS, CASCADE constants"],
              ["session", "createSession, endSession, session lifecycle"],
              ["chat", "startChat, finalizeChat, chat tracking"],
              ["llm", "processMessage, switchMode, runChat, runPipeline"],
              ["mcp", "connectToMCP, closeMCPClient"],
              ["websocket", "emitNavigate, emitToUser, registerSocketHandler"],
              ["orchestrator", "OrchestratorRuntime, acquireLock, releaseLock"],
              ["orchestrators", "register, get (orchestrator registry)"],
              ["cascade", "deliverCascade"],
              ["ownership", "addContributor, removeContributor, setOwner"],
              ["tree", "getAncestorChain, checkIntegrity, getCacheStats"],
            ].map(([name, desc]) => (
              <div key={name} style={{display: "flex", gap: 12, padding: "4px 0", borderBottom: "1px solid rgba(255,255,255,0.04)"}}>
                <code style={{color: "#4ade80", minWidth: 130}}>{name}</code>
                <span style={{color: "#888"}}>{desc}</span>
              </div>
            ))}
          </div>

          <h3 style={{color: "#fff", marginTop: 32}}>needs.models</h3>
          <P>Core models: <code>Node</code>, <code>User</code>, <code>Note</code>, <code>Contribution</code>, <code>LlmConnection</code>, <code>Chat</code>.</P>

          <h3 style={{color: "#fff", marginTop: 32}}>optional</h3>
          <P>
            Same structure as <code>needs</code>. If missing, your extension still loads.
            Optional services get no-op stubs. Optional extensions just aren't there.
          </P>
          <Code>{`optional: {
  services: ["energy"],        // gets no-op stub if energy extension not loaded
  extensions: ["billing"],     // loaded after if present, ignored if not
}`}</Code>

          <h3 style={{color: "#fff", marginTop: 32}}>provides</h3>
          <Code>{`provides: {
  routes: "./routes.js",       // Express router mounted at /api/v1
  tools: true,                 // init() returns tools array
  modes: true,                 // init() registers modes
  jobs: "./jobs.js",           // Background job module
  orchestrator: false,         // Or path to orchestrator pipeline
  hooks: {
    fires: ["my-ext:afterProcess"],
    listens: ["afterNote", "enrichContext"],
  },
  cli: [
    { command: "my-cmd", description: "Does a thing", method: "POST", endpoint: "/my-ext/do" },
  ],
  env: [
    { key: "MY_EXT_API_KEY", required: true, description: "API key for external service" },
  ],
}`}</Code>

          <h3 style={{color: "#fff", marginTop: 32}}>npm</h3>
          <P>
            Extensions that need npm packages declare them at the manifest top level.
            The loader generates a <code>package.json</code> in the extension directory and
            runs <code>npm install</code> automatically. Scoped to the extension. Does not
            pollute the land's root <code>node_modules</code>.
          </P>
          <Code>{`// manifest.js
export default {
  name: "gateway-discord",
  version: "1.0.0",
  npm: ["discord.js@^14.0.0"],
  // ...
};

// Then import normally in your code:
import { Client, GatewayIntentBits } from "discord.js";`}</Code>
          <P style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem"}}>
            Install scripts are blocked (<code>--ignore-scripts</code>). If <code>node_modules</code> is
            missing on boot (fresh clone, deleted), the loader detects and reinstalls automatically.
            Failed npm install during extension installation rolls back the entire extension. 60s timeout
            configurable via <code>npmInstallTimeout</code> in land config.
          </P>
        </div>
      </section>

      {/* ── 3. INIT ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">init(core)</h2>
          <P>
            The entry point. Receives the scoped services bundle.
            Register hooks, modes, socket handlers. Return routes, tools, jobs, exports.
          </P>
          <Code>{`export async function init(core) {
  // Register hooks
  core.hooks.register("afterNote", handler, "my-ext");

  // Register modes
  core.modes.registerMode("tree:my-mode", modeConfig, "my-ext");

  // Register socket handlers
  core.websocket.registerSocketHandler("myEvent", handler);

  // Register auth strategy
  core.auth.registerStrategy("myAuth", handler);

  return {
    router,              // Express router at /api/v1
    tools: [...],        // MCP tools with zod schemas + handlers
    jobs: { start() {} },// Background jobs with start/stop
    pageRouter,          // Pages at / (like html-rendering)
    exports: {           // For other extensions via getExtension()
      doSomething,
      myHelper,
    },
  };
}`}</Code>
        </div>
      </section>

      {/* ── 4. STORING DATA ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Storing Data</h2>
          <P>
            Extension data lives in the metadata Map on nodes and users.
            Each extension gets its own namespace. 512KB per namespace per node.
            Writes are atomic MongoDB <code>$set</code> operations.
          </P>
          <Code>{`import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";
import { getUserMeta, setUserMeta } from "../../seed/tree/userMetadata.js";

// Node metadata
const data = getExtMeta(node, "my-ext");        // { key: "value" } or {}
await setExtMeta(node, "my-ext", { key: "value" }); // atomic $set

// User metadata
const prefs = getUserMeta(user, "my-ext");
setUserMeta(user, "my-ext", { theme: "dark" });
await user.save();`}</Code>
          <P style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem"}}>
            <code>setExtMeta</code> is async. Always <code>await</code> it. Spatial scoping
            blocks writes from extensions that are blocked at the node's position.
          </P>
        </div>
      </section>

      {/* ── 5. HOOKS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Hooks</h2>
          <P>
            30 kernel hooks. <code>before</code> hooks run sequentially and can cancel.
            <code> after</code> hooks run in parallel. 5s timeout per handler.
            Circuit breaker auto-disables after 5 failures (half-open recovery after 5 minutes).
          </P>
          <Code>{`// Listen to a kernel hook
core.hooks.register("afterNote", async ({ note, nodeId, userId }) => {
  // React to note creation
}, "my-ext");

// Cancel an operation (before hooks only)
core.hooks.register("beforeNodeCreate", async (data) => {
  if (data.name.startsWith("_")) return false; // cancels creation
}, "my-ext");

// Fire your own hook (other extensions can listen)
await core.hooks.run("my-ext:afterProcess", { result, userId });`}</Code>
          <P>
            Declare hooks in your manifest under <code>provides.hooks.fires</code> and
            <code> provides.hooks.listens</code>. Spatial scoping: if your extension is
            blocked at a node, your hook handlers are skipped for operations on that node.
          </P>
        </div>
      </section>

      {/* ── 6. MODES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">AI Modes</h2>
          <P>
            A mode defines how the AI thinks at a position. System prompt + tool list.
            The kernel injects <code>[Position]</code> before your prompt automatically.
            You never need to include rootId or currentNodeId.
          </P>
          <Code>{`// modes/coach.js
export default {
  name: "tree:my-coach",
  emoji: "🏋️",
  label: "Coach",
  bigMode: "tree",
  toolNames: ["get-tree", "get-node", "create-new-node"],
  buildSystemPrompt({ username, rootId }) {
    return \`You are \${username}'s personal coach.
Your job is to help them organize and track their goals.\`;
  },
};

// In init():
core.modes.registerMode("tree:my-coach", coachMode, "my-ext");`}</Code>
        </div>
      </section>

      {/* ── 7. MCP TOOLS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">MCP Tools</h2>
          <P>
            Tools let the AI act on the tree. Define with a zod schema and an async handler.
            The loader registers them on the MCP server. <code>readOnlyHint</code> matters
            for spatial scoping (restricted extensions keep read-only tools).
          </P>
          <Code>{`import { z } from "zod";

const tools = [
  {
    name: "my-ext-lookup",
    description: "Look up data in the my-ext index",
    schema: {
      nodeId: z.string().describe("Node to look up"),
      query: z.string().optional().describe("Search query"),
    },
    annotations: { readOnlyHint: true },
    handler: async ({ nodeId, query }) => {
      const result = await doLookup(nodeId, query);
      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
      };
    },
  },
];

// In init():
return { tools };`}</Code>
        </div>
      </section>

      {/* ── 8. CLI COMMANDS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">CLI Commands</h2>
          <P>
            Declare in the manifest. The CLI discovers them from <code>/api/v1/protocol</code>.
            Each command maps to an HTTP method + endpoint.
          </P>
          <Code>{`provides: {
  cli: [
    {
      command: "my-cmd [message...]",
      description: "Do something with a message",
      method: "POST",
      endpoint: "/root/:rootId/my-ext",
      bodyMap: { message: 0 },  // maps first arg to body.message
    },
    {
      command: "my-list",
      description: "List things",
      method: "GET",
      endpoint: "/user/:userId/my-ext",
    },
  ],
}`}</Code>
          <P style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem"}}>
            Required fields: <code>command</code>, <code>description</code>, <code>method</code>, <code>endpoint</code>.
            The CLI replaces <code>:rootId</code>, <code>:userId</code>, <code>:nodeId</code> with the current context.
          </P>
        </div>
      </section>

      {/* ── 9. ROUTES ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Routes</h2>
          <P>
            Return an Express router from <code>init()</code>. Mounted at <code>/api/v1</code>.
            Use <code>sendOk</code>/<code>sendError</code> from protocol.
          </P>
          <Code>{`import express from "express";
import authenticate from "../../seed/middleware/authenticate.js";
import { sendOk, sendError, ERR } from "../../seed/protocol.js";

const router = express.Router();

router.get("/my-ext/data", authenticate, async (req, res) => {
  try {
    const data = await getData(req.userId);
    sendOk(res, { items: data });
  } catch (err) {
    sendError(res, 500, ERR.INTERNAL, err.message);
  }
});

// In init():
return { router };`}</Code>
        </div>
      </section>

      {/* ── 10. BACKGROUND JOBS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Background Jobs</h2>
          <P>
            Return a jobs object with <code>start()</code>. Use <code>.unref()</code> on timers
            for graceful shutdown. Read intervals from land config.
          </P>
          <Code>{`// jobs.js
import { getLandConfigValue } from "../../seed/landConfig.js";

export function start() {
  const interval = Number(getLandConfigValue("myExtInterval")) || 3600000;
  const timer = setInterval(async () => {
    // do periodic work
  }, interval);
  if (timer.unref) timer.unref();
}

// In init():
const jobs = await import("./jobs.js");
return { jobs };`}</Code>
        </div>
      </section>

      {/* ── 11. CROSS-EXTENSION ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Cross-Extension Communication</h2>
          <P>Three patterns. Extensions never import each other directly.</P>
          <Code>{`// 1. Hooks (pub/sub)
core.hooks.run("my-ext:afterProcess", { result });
// Another extension:
core.hooks.register("my-ext:afterProcess", handler, "other-ext");

// 2. Exports (direct call)
import { getExtension } from "../loader.js";
const other = getExtension("other-ext")?.exports;
if (other) other.doSomething();

// 3. Metadata (shared state on nodes)
// Extension A writes: await setExtMeta(node, "ext-a", { score: 42 });
// Extension B reads:  const data = getExtMeta(node, "ext-a");`}</Code>
        </div>
      </section>

      {/* ── 12. MIGRATIONS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Schema Migrations</h2>
          <P>
            When your metadata format changes, write a migration. The loader runs pending
            migrations at boot based on <code>schemaVersion</code> in your manifest.
          </P>
          <Code>{`// manifest.js
{ schemaVersion: 2, ... }

// migrations.js
export default {
  2: async () => {
    // Migrate from v1 to v2
    const nodes = await Node.find({ "metadata.my-ext": { $exists: true } });
    for (const node of nodes) {
      const old = getExtMeta(node, "my-ext");
      await setExtMeta(node, "my-ext", { ...old, newField: old.oldField });
    }
  },
};`}</Code>
        </div>
      </section>

      {/* ── 13. PUBLISHING ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Publishing</h2>
          <P>
            <code>treeos ext publish my-ext</code> sends your extension's manifest and files
            to the Horizon. The Horizon indexes metadata (name, version, description, deps).
            Extension code lives on your land. The Horizon is a search index, not a host.
          </P>
          <P>
            Other operators install with <code>treeos ext install my-ext</code>. The CLI pulls
            from your land. SHA256 checksum verified on install.
          </P>
        </div>
      </section>

      {/* ── 14. COMMON PATTERNS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Common Patterns</h2>

          <h3 style={{color: "#4ade80", marginTop: 24}}>enrichContext (inject into AI prompts)</h3>
          <Code>{`core.hooks.register("enrichContext", async ({ context, node }) => {
  const data = getExtMeta(node, "my-ext");
  if (data.summary) {
    context.myExt = "[My Extension] " + data.summary;
  }
}, "my-ext");`}</Code>

          <h3 style={{color: "#4ade80", marginTop: 24}}>Optional energy wiring</h3>
          <Code>{`// manifest: optional: { services: ["energy"] }
let energy = null;
export function setEnergyService(svc) { energy = svc; }

// In init():
if (core.energy) setEnergyService(core.energy);

// When needed:
if (energy) await energy.useEnergy({ userId, action: "my-action" });`}</Code>

          <h3 style={{color: "#4ade80", marginTop: 24}}>HTML rendering integration</h3>
          <Code>{`import { getExtension } from "../loader.js";

// Check if HTML rendering is available
if (!getExtension("html-rendering")) {
  return sendOk(res, jsonData);
}

// Render HTML
const html = getExtension("html-rendering").exports;
res.send(html.renderMyPage({ data }));`}</Code>
        </div>
      </section>

      {/* ── 15. ERROR REFERENCE ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Common Mistakes</h2>
          <div style={{fontSize: "0.85rem"}}>
            {[
              ["Cannot read properties of undefined (reading 'sendOk')", "Missing needs.services: [\"protocol\"] in manifest. The loader scopes core to declared services."],
              ["Cannot read properties of undefined (reading 'registerStrategy')", "Missing needs.services: [\"auth\"] in manifest."],
              ["setExtMeta doesn't persist", "setExtMeta is async. Add await. Without it, the MongoDB $set may not complete before the response sends."],
              ["Extension skipped on boot (no error)", "Check the boot log. Missing required env var, unmet dependency, or manifest validation failure. The loader logs the reason."],
              ["Tool not available to AI", "Check: (1) tool returned from init() in tools array, (2) tool name in mode's toolNames, (3) extension not blocked at this node position."],
              ["Hook handler never fires", "Check: (1) hook name spelling (typo detection warns but doesn't block), (2) extension blocked at node position, (3) circuit breaker tripped (5 failures)."],
              ["Module not found: ../../core/...", "Old path. The kernel is at ../../seed/... not ../../core/..."],
            ].map(([err, fix]) => (
              <div key={err} style={{padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.04)"}}>
                <code style={{color: "#f87171", fontSize: "0.8rem", display: "block", marginBottom: 4}}>{err}</code>
                <span style={{color: "#888"}}>{fix}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{textAlign: "center"}}>
          <P>
            The full extension format specification lives in{" "}
            <code>land/extensions/EXTENSION_FORMAT.md</code> in the repo.
            This page covers what you need to get started. The spec covers everything.
          </P>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div className="lp-footer-col">
              <h4>Docs</h4>
              <a href="/guide">Guide</a>
              <a href="/seed">The Seed</a>
              <a href="/ai">The AI</a>
              <a href="/cascade">Cascade</a>
              <a href="/flow">The Flow</a>
              <a href="/extensions">Extensions</a>
              <a href="/build">Build</a>
              <a href="/network">The Network</a>
              <a href="/mycelium">Mycelium</a>
              <a href="/lands">Start a Land</a>
              <a href="/cli">CLI</a>
            </div>
            <div className="lp-footer-col">
              <h4>TreeOS</h4>
              <a href="/use">Use</a>
              <a href="/about/api">API</a>
              <a href="/about/gateway">Gateway</a>
              <a href="/about/energy">Energy</a>
            </div>
            <div className="lp-footer-col">
              <h4>Community</h4>
              <a href="https://horizon.treeos.ai">Horizon</a>
              <a href="/blog">Blog</a>
            </div>
            <div className="lp-footer-col">
              <h4>Source</h4>
              <a href="https://github.com/taborgreat/create-treeos">GitHub</a>
              <a href="https://github.com/taborgreat/TreeOS/blob/main/LICENSE">AGPL-3.0 License</a>
            </div>
          </div>
          <div className="lp-footer-bottom">
            TreeOS . AGPL-3.0 . <a href="https://tabors.site" style={{color: "inherit", textDecoration: "none"}}>Tabor Holly</a>
          </div>
        </div>
      </footer>
    </div>
  );
};

const P = ({ children, style }) => (
  <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.8, marginBottom: 16, fontSize: "1rem", ...style}}>
    {children}
  </p>
);

const Code = ({ children }) => (
  <pre style={{
    background: "rgba(0,0,0,0.4)",
    border: "1px solid rgba(255,255,255,0.08)",
    borderRadius: 8,
    padding: "16px 20px",
    color: "rgba(255,255,255,0.65)",
    fontSize: "0.85rem",
    lineHeight: 1.6,
    overflowX: "auto",
    marginBottom: 16,
  }}>{children}</pre>
);

export default BuildPage;
