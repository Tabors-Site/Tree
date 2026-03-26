import "../Landing/LandingPage.css";

const Guide = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "50vh"}}>
        <div className="lp-hero-inner">
          <h1 className="lp-title">The Guide</h1>
          <p className="lp-subtitle">Simple to advanced. Everything you need to know.</p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/">Home</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/flow">The Flow</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 1. WHAT IS THIS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">What Is This?</h2>
          <P>
            The seed is an open source kernel for AI agents. You plant it on a server. It grows trees.
            Trees are hierarchical data structures where AI lives permanently. It builds, navigates,
            remembers, and connects to other servers through a federated network.
          </P>
          <P>
            The kernel is minimal: two database schemas (Node and User), a conversation loop,
            a hook system, a cascade engine, and an extension loader. Everything else is an extension
            you install. Strip every extension and the seed still boots. It defines the data contract
            that everything builds on.
          </P>
          <P>
            TreeOS is one operating system built on the seed. It ships with 25+ extensions that
            work together: AI modes, tree orchestration, values, schedules, understanding, energy,
            HTML rendering, gateway channels. But TreeOS is just one interpretation. A medical
            platform, a code review pipeline, a research assistant could all be built on the same kernel.
            Same relationship as Linux and Ubuntu. The seed is the kernel. The extensions are the distribution.
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 2. QUICK START */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Quick Start</h2>
          <P>Run a land (server):</P>
          <Code>{`git clone https://github.com/Tabors-Site/Tree && cd Tree
npm run install:all
npm start`}</Code>
          <P>First boot walks you through setup: domain, name, LLM connection, extension selection.</P>
          <P>Or connect to an existing land as a user:</P>
          <Code>{`npm install -g treeos
treeos connect https://treeos.ai
treeos register
treeos start`}</Code>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 3. THE VOCABULARY */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The Vocabulary</h2>
          <div style={{maxWidth: 650, margin: "0 auto"}}>
            {[
              ["Seed", "The kernel. Two schemas, conversation loop, hooks, cascade, extension loader. Never changes."],
              ["Land", "One running server. One database. One seed. The ground everything grows from."],
              ["Tree", "A root node with children. The data structure users and AI work in."],
              ["Node", "One item in a tree. Has a name, type, status, children, parent, metadata Map."],
              ["Note", "Text or file content attached to a node. The primary data unit."],
              ["Extension", "A folder with a manifest and an init function. Adds capabilities to the land."],
              ["Cascade", "Signals that flow between nodes when content is written. The tree's nervous system."],
              [".flow", "System node that stores cascade results in daily partitions. The land's water table."],
              ["Canopy", "The federation protocol. How lands discover and connect to each other."],
              ["Mode", "How the AI thinks at a position. Extensions register modes. The kernel resolves them."],
              ["Orchestrator", "The entire conversation flow. Replaceable. The built-in one is itself an extension."],
              ["Zone", "Land (/), Home (~), or Tree (/MyTree). Where you are determines what the AI can do. Kernel concept."],
              ["Seed Version", "How the kernel tracks its own version for migrations. Checked at boot. Migrations run in order."],
              ["Perspective Filter", "How trees control what cascade signals they accept. Extension-level filtering on .flow data."],
            ].map(([term, desc]) => (
              <div key={term} style={{padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)"}}>
                <span style={{color: "#4ade80", fontWeight: 700, marginRight: 12}}>{term}</span>
                <span style={{color: "rgba(255,255,255,0.55)", fontSize: "0.95rem"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 4. THREE ZONES */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Three Zones</h2>
          <P>
            Where you are determines what the AI can do. No mode switching menu. Navigation is
            mode switching. <code>cd /</code> and the AI becomes a system operator.
            <code> cd ~</code> and it becomes your personal assistant. <code>cd MyTree</code> and
            it works the tree with you. Tools, context, and behavior change automatically.
          </P>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3 style={{color: "#f97316"}}>Land <code>/</code></h3>
              <p>System management. Extensions, config, users, peers, diagnostics. Admin access required.</p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#a78bfa"}}>Home <code>~</code></h3>
              <p>Personal space. Raw ideas, notes across trees, chat history, contributions. Organize and reflect.</p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#4ade80"}}>Tree <code>/MyTree</code></h3>
              <p><strong>Chat</strong> reads and writes. <strong>Place</strong> adds content silently. <strong>Query</strong> reads only. The orchestrator classifies intent.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 5. CLI */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The CLI</h2>
          <P>
            Works like a regular terminal. <code>cd</code>, <code>ls</code>,
            <code> mkdir</code>, <code>rm</code>, <code>mv</code>. Navigate trees like a filesystem.
            Extension commands appear automatically based on what the connected land has installed.
          </P>
          <Code>{`treeos cd Goals/Fitness
treeos chat "add a back and biceps routine"
treeos note "Hit 135 on bench today"
treeos tree
treeos ext-scope         # see what's active here
treeos config set maxToolIterations 25`}</Code>
          <P style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem"}}>
            Note: the CLI is built for TreeOS. It is not part of the seed. It is one of the first
            tools built on the kernel to give users and developers direct access to the tree.
            Anyone building on the seed can build their own CLI, frontend, or interface.
          </P>
          <P>
            <a href="/about/cli" style={{color: "rgba(255,255,255,0.7)"}}>Full CLI reference</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 6. THE SEED (KERNEL) */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The Seed</h2>
          <P>
            Four primitives. <strong>Structure</strong>: two schemas, nodes in hierarchies.
            <strong> Intelligence</strong>: the conversation loop, resolution chains.
            <strong> Extensibility</strong>: the loader, hooks, registries.
            <strong> Communication</strong>: cascade, .flow, visible results.
          </P>
          <P>
            <strong>Node</strong> (12 fields): name, type, status, dateCreated, llmDefault, visibility,
            children[], parent, rootOwner, contributors[], systemRole, metadata (Map).
            Type is free-form. Status is active, completed, or trimmed.
          </P>
          <P>
            <strong>User</strong> (7 fields): username, password, llmDefault, isAdmin,
            isRemote, homeLand, metadata (Map). Extensions store everything in the metadata Map
            under their own namespace.
          </P>
          <P>
            Six system nodes created at boot: Land Root, .identity (Ed25519 keys), .config (all runtime config),
            .peers (federation), .extensions (registry), .flow (cascade results in daily partitions).
          </P>
          <P>
            <a href="/seed" style={{color: "rgba(255,255,255,0.7)"}}>Deep dive: The Seed</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 7. THE AI */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">How AI Works</h2>
          <P>
            Every AI interaction goes through the conversation loop: resolve LLM, resolve tools,
            build prompt with position injection, enter the tool loop. The loop calls the LLM,
            executes tool calls via MCP, appends results, repeats until done or hits the iteration cap.
          </P>
          <P>
            The <code>[Position]</code> block is injected into every prompt before the mode's own content.
            The AI always knows where it is. Extension modes cannot exclude it.
          </P>
          <Code>{`[Position]
User: tabor
Tree: My Fitness (abc-123-def)
Current node: Push Day (xyz-456-ghi)

You are tabor's personal fitness coach...`}</Code>
          <P>
            Four resolution chains determine what happens at every position:
          </P>
          <ol style={{color: "rgba(255,255,255,0.6)", lineHeight: 2, paddingLeft: 20}}>
            <li><strong>Extension scope</strong>: walk parent chain, accumulate blocked/restricted extensions</li>
            <li><strong>Tool scope</strong>: mode base tools + extension tools + per-node allowed/blocked</li>
            <li><strong>Mode resolution</strong>: per-node override, then default, then fallback</li>
            <li><strong>LLM resolution</strong>: extension slot on tree, tree default, user slot, user default</li>
          </ol>
          <P>
            Two entry points for extensions: <code>runChat()</code> for single messages with persistent sessions,
            and <code>OrchestratorRuntime</code> for multi-step pipelines. Both handle MCP connection,
            session management, chat tracking, abort, and cleanup automatically.
          </P>
          <P>
            <a href="/ai" style={{color: "rgba(255,255,255,0.7)"}}>Deep dive: The AI</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 8. EXTENSIONS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Extensions</h2>
          <P>
            A folder with <code>manifest.js</code> and <code>index.js</code>.
            The manifest declares what it needs (models, services, other extensions with semver)
            and what it provides (CLI commands, env vars, indexes). The index exports
            <code> init(core)</code> which receives the services bundle and returns routes, tools,
            jobs, page routes, and exports.
          </P>
          <P>
            An extension can provide: HTTP routes, MCP tools for the AI, AI conversation modes,
            a custom orchestrator, background jobs, lifecycle hooks, CLI commands, Mongoose models,
            session types, LLM assignment slots, and exported functions for other extensions.
          </P>
          <P>
            Five registries, same pattern: <strong>Hooks</strong> (27 lifecycle events),
            <strong> Modes</strong> (AI behavior per position), <strong>Orchestrators</strong> (conversation flow),
            <strong> Socket Handlers</strong> (real-time events), <strong>Auth Strategies</strong> (authentication methods).
            Extensions register. The kernel resolves.
          </P>
          <P>
            <strong>Spatial scoping</strong>: block an extension at any node and it loses all power at that
            position and every descendant. Tools disappear. Hooks stop firing. Modes don't resolve.
            Restrict to read-only and only read tools survive. Navigate somewhere and the capability
            surface changes.
          </P>
          <Code>{`treeos ext-block shell solana     # blocked at this node and below
treeos ext-restrict food read     # food is read-only here
treeos ext-scope                  # see what's active at this position`}</Code>
          <P>
            Install from the registry: <code>treeos ext install understanding</code>.
            Publish your own: <code>treeos ext publish my-extension</code>.
            Browse what exists at <a href="https://horizon.treeos.ai" style={{color: "rgba(255,255,255,0.7)"}}>horizon.treeos.ai</a>.
          </P>
          <P>
            <a href="/extensions" style={{color: "rgba(255,255,255,0.7)"}}>Deep dive: Extensions</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 9. HOOKS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">27 Hooks</h2>
          <P>
            An open pub/sub bus. Before hooks run sequentially and can cancel. After hooks
            run in parallel and react. Sequential hooks (enrichContext, onCascade) build
            cumulative output. Any hook name is valid. Extensions fire their own.
          </P>
          <div style={{maxWidth: 600, margin: "0 auto", fontSize: "0.85rem"}}>
            {[
              ["beforeNote / afterNote", "Before/after note save"],
              ["beforeNodeCreate / afterNodeCreate", "Before/after node creation"],
              ["beforeStatusChange / afterStatusChange", "Before/after status write"],
              ["beforeNodeDelete", "Before deletion, cleanup"],
              ["beforeContribution", "Modify contribution data"],
              ["enrichContext", "Inject extension data into AI context (sequential)"],
              ["beforeLLMCall / afterLLMCall", "Before/after LLM API call"],
              ["beforeToolCall / afterToolCall", "Before/after MCP tool execution"],
              ["beforeResponse", "Modify AI response before client"],
              ["beforeRegister / afterRegister", "Before/after user registration"],
              ["afterSessionCreate / afterSessionEnd", "Session lifecycle"],
              ["afterNavigate", "Tree navigation"],
              ["afterMetadataWrite", "Metadata changes"],
              ["afterScopeChange", "Extension scope changes"],
              ["afterOwnershipChange", "Ownership or contributors changed"],
              ["afterBoot", "One-time post-boot setup"],
              ["onCascade", "Cascade signal handler (sequential)"],
              ["onDocumentPressure", "Document approaching 14MB limit"],
              ["onTreeTripped / onTreeRevived", "Tree circuit breaker events"],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", justifyContent: "space-between", padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)", gap: 12,
              }}>
                <code style={{color: "#4ade80", fontSize: "0.8rem", whiteSpace: "nowrap"}}>{name}</code>
                <span style={{color: "#666", textAlign: "right"}}>{desc}</span>
              </div>
            ))}
          </div>
          <P style={{marginTop: 16}}>
            5s timeout per handler. 100 handlers per hook cap. Circuit breaker auto-disables
            after 5 consecutive failures. Spatial scoping filters: blocked extensions' handlers are skipped.
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 10. CASCADE */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Cascade</h2>
          <P>
            When content is written at a node with <code>metadata.cascade.enabled = true</code> and
            <code> cascadeEnabled = true</code> in .config, the kernel fires <code>onCascade</code>.
            Extensions propagate signals to children, siblings, or remote lands via Canopy.
            Every signal produces a visible result stored in .flow.
          </P>
          <P>
            Two entry points. <code>checkCascade</code> is seed-internal (fires automatically on content writes).
            <code> deliverCascade</code> is extension-external (extensions call it to propagate). The kernel
            never blocks inbound. Always accepts. Always writes a result.
          </P>
          <P>
            Six result statuses: succeeded, failed, rejected, queued, partial, awaiting. None terminal.
            Results stored in daily partition nodes under .flow. <code>flowMaxResultsPerDay</code> caps
            growth per partition with circular overwrite. Retention deletes entire partitions by date.
          </P>
          <P>
            <a href="/cascade" style={{color: "rgba(255,255,255,0.7)"}}>Deep dive: Cascade (technical spec)</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 12px"}}>.</span>
            <a href="/flow" style={{color: "rgba(255,255,255,0.7)"}}>The Flow (water cycle)</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 11. LLM SYSTEM */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">LLM System</h2>
          <P>
            Model-agnostic. Any OpenAI-compatible endpoint: Ollama, OpenRouter, Anthropic, local models.
            Each user has a default LLM connection. Tree owners can override per-tree.
            Extensions register additional LLM slots in metadata for per-mode assignments.
          </P>
          <P>
            Resolution chain: extension slot on tree, tree default, extension slot on user, user default.
            First match wins. Failover chain on 429/500 errors. Configurable timeout and retry count.
          </P>
          <Code>{`treeos llm add            # add a connection
treeos llm assign         # assign to tree or mode`}</Code>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 12. FEDERATION */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Federation</h2>
          <P>
            Lands connect through the Canopy protocol. Each land is sovereign. Your data stays
            on your server. Remote users are ghost records (username + home land URL). The real
            user data never leaves their home land.
          </P>
          <P>
            Peers discover each other through the Horizon at <a href="https://horizon.treeos.ai" style={{color: "rgba(255,255,255,0.7)"}}>horizon.treeos.ai</a> or
            by direct peering. The Horizon is discovery, not authority. Remove it and peering still works.
            Messages are signed with Ed25519 keys from .identity. Heartbeats exchange extension lists
            and health status, not user data.
          </P>
          <P>
            Cascade signals flow between lands. A tree on Land A writes content. An extension propagates
            to Land B via Canopy. Land B's kernel accepts it (never block inbound), fires onCascade,
            writes to .flow. The metadata Map preserves all extension data across transit.
          </P>
          <P>
            <a href="/network" style={{color: "rgba(255,255,255,0.7)"}}>Deep dive: The Network</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 13. KERNEL CONFIG */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Kernel Config</h2>
          <P>
            Every tunable value lives in the .config system node. Readable and writable via CLI,
            API, or the land-manager AI. No code editing. No restarts for most values.
          </P>
          <Code>{`treeos config set maxToolIterations 25
treeos config set llmTimeout 900
treeos config set cascadeEnabled true
treeos config set treeCircuitEnabled true`}</Code>
          <P>
            <strong>77</strong> config keys. The kernel owns every one.
          </P>
          <P>
            Covering: LLM (timeout, retries, model), conversation (tool iterations,
            context window, carry messages), sessions (TTL, stale timeout, max), notes (max chars),
            tree summary (depth, nodes), retention (chats, contributions), cascade
            (enabled, depth, payload, rate limit, result TTL, flow cap), uploads (enabled, max size,
            MIME filter), document guard (max size), ancestor cache (TTL), integrity check (interval),
            tree circuit breaker (enabled, thresholds, weights, interval), tool circuit breaker (threshold),
            and seed version.
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 14. SAFETY */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Safety</h2>
          <P>The kernel protects itself from extensions, from runaway AI, and from time.</P>
          <div style={{fontSize: "0.85rem"}}>
            {[
              ["Hook circuit breaker", "5 consecutive failures auto-disables the handler"],
              ["Tool circuit breaker", "5 consecutive failures disables one tool per session"],
              ["Tree circuit breaker", "Health equation trips the tree. No AI, no writes. Extensions revive."],
              ["Document size guard", "14MB ceiling, 512KB per namespace, onDocumentPressure at 80%"],
              [".flow partitioning", "Daily partitions, circular overwrite, retention by date"],
              ["Ancestor cache", "One walk serves all six resolution chains. Snapshot per message."],
              ["DB health check", "Before each tool call. Dead DB tells the AI to inform the user."],
              ["Atomic metadata", "MongoDB $set per namespace. Concurrent writes never clobber."],
              ["Tree integrity", "On boot and daily. Auto-repair phantom refs and broken links."],
              ["Index verification", "On boot. Create missing indexes. No collection scans."],
              ["Seed versioning", "Migrations run in order. Failed migrations retry next boot."],
              ["Ownership chain", "rootOwner/contributor mutations validate the parent chain."],
              ["Extension route timeout", "Page routes (/) wrapped with 5s timeout. API routes (/api/v1) are not. AI chat routes can take as long as the LLM needs."],
              ["Graceful shutdown", "All timers .unref(). SIGTERM closes clean."],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", gap: 12, padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
              }}>
                <span style={{color: "#4ade80", minWidth: 170, fontWeight: 600, fontSize: "0.8rem"}}>{name}</span>
                <span style={{color: "#666"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 15. BUILDING EXTENSIONS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Building Extensions</h2>
          <P>
            Create a folder in <code>extensions/</code>. Add <code>manifest.js</code> and
            <code> index.js</code>. Restart. Your extension loads.
          </P>
          <Code>{`// manifest.js
export default {
  name: "my-ext",
  version: "1.0.0",
  needs: { models: ["Node"], services: ["hooks", "protocol"] },
  provides: { cli: [{ command: "my-cmd", description: "Does a thing" }] },
};

// index.js
export async function init(core) {
  core.hooks.register("afterNote", async (data) => {
    // react to notes being written
  }, "my-ext");

  return {
    router,         // HTTP routes at /api/v1
    tools: [...],   // MCP tools for the AI
    exports: { ... }, // for other extensions
  };
}`}</Code>
          <P>
            Store data in <code>node.metadata</code> under your extension name via <code>setExtMeta</code>.
            Communicate with other extensions through hooks (pub/sub), exports (direct call via
            <code> getExtension()</code>), or metadata (shared state on nodes).
          </P>
          <P>
            An operating system is just extensions working together. When enough extensions
            depend on each other, a coherent experience emerges. The seed doesn't care
            what you build. It grows whatever you plant.
          </P>
          <P>
            <a href="/build" style={{color: "#4ade80"}}>Full developer reference</a> covers every manifest field, hook,
            tool registration pattern, and common mistake. Check out extensions at{" "}
            <a href="https://horizon.treeos.ai" style={{color: "rgba(255,255,255,0.7)"}}>horizon.treeos.ai</a> and
            publish your own.
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 16. BUILDING ORCHESTRATORS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Building a Custom Orchestrator</h2>
          <P>
            The most ambitious thing you can build on the seed. A custom orchestrator replaces how
            the AI thinks about and responds to every message in a zone. The built-in orchestrator
            ships as the treeos extension. Uninstall it and plug in your own.
          </P>
          <Code>{`export async function init(core) {
  core.orchestrators.register("tree", {
    async handle({ message, userId, rootId, socket }) {
      // Your entire AI flow
      const { answer } = await core.llm.runChat({
        userId, username: socket.username,
        message,
        mode: "my-custom:mode",
      });
      return { answer };
    }
  });
}`}</Code>
          <P>
            Multi-agent debate. Parallel research. Code review pipeline. The kernel dispatches
            to whatever orchestrator is registered. One extension. One init() call. The whole AI changes.
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 17. BOOT SEQUENCE */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Boot Sequence</h2>
          <P>Each step depends on the one before it.</P>
          <ol style={{color: "rgba(255,255,255,0.6)", lineHeight: 2.2, paddingLeft: 20, fontSize: "0.95rem"}}>
            <li>Database connect</li>
            <li>Index verification (create missing indexes)</li>
            <li>System nodes (ensureLandRoot, .identity, .config, .peers, .extensions, .flow)</li>
            <li>Config load from .config node</li>
            <li>Seed migrations (version check, run pending)</li>
            <li>Tree integrity check (parent/children[] consistency, auto-repair)</li>
            <li>Extension discovery (scan manifests)</li>
            <li>Dependency resolution (topological sort)</li>
            <li>Extension init (call init(core) in order)</li>
            <li>Wire (routes, tools, hooks, modes, jobs, indexes)</li>
            <li>MCP transport connect (must be after wire. Tools register during wire. SDK locks after connect. Reordering this breaks silently.)</li>
            <li>Background jobs (retention, upload cleanup, integrity, circuit breaker)</li>
            <li>Canopy peering, heartbeat, outbox, Horizon registration</li>
            <li>afterBoot hook fires</li>
          </ol>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 18. API */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">API</h2>
          <P>
            REST at <code>/api/v1/</code>. Bearer token or API key auth. Every tree operation,
            note, value, and AI interaction is accessible via HTTP. The protocol endpoint at
            <code> /api/v1/protocol</code> returns loaded extensions, capabilities, and CLI commands.
          </P>
          <P>
            Response shape: <code>{"{ status: \"ok\", data }"}</code> or
            <code> {"{ status: \"error\", error: { code, message } }"}</code>.
            Semantic error codes (NODE_NOT_FOUND, UNAUTHORIZED, DOCUMENT_SIZE_EXCEEDED, etc.)
            that mean something. Extensions access through <code>core.protocol</code>.
          </P>
          <P>
            <a href="/about/api" style={{color: "rgba(255,255,255,0.7)"}}>Full API reference</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 18.5 PROTOCOL REFERENCE */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Protocol Reference</h2>
          <P>
            Every HTTP response is <code>{"{ status: \"ok\", data }"}</code> or
            <code> {"{ status: \"error\", error: { code, message } }"}</code>.
            The <code>code</code> field is one of these semantic constants from <code>protocol.js</code>.
          </P>
          <div style={{fontSize: "0.8rem", marginBottom: 32}}>
            {[
              ["400", "INVALID_INPUT", "Malformed request"],
              ["400", "INVALID_STATUS", "Bad status value"],
              ["400", "INVALID_TYPE", "Bad type value"],
              ["400", "INVALID_TREE", "Broken tree structure (no rootOwner, circular ref)"],
              ["401", "UNAUTHORIZED", "No auth, bad auth"],
              ["403", "FORBIDDEN", "Authenticated but denied"],
              ["403", "EXTENSION_BLOCKED", "Extension blocked at position"],
              ["403", "SESSION_EXPIRED", "Session timed out"],
              ["403", "CASCADE_DISABLED", "cascadeEnabled is false"],
              ["403", "UPLOAD_DISABLED", "uploadEnabled is false"],
              ["404", "NODE_NOT_FOUND", "Node doesn't exist"],
              ["404", "USER_NOT_FOUND", "User doesn't exist"],
              ["404", "NOTE_NOT_FOUND", "Note doesn't exist"],
              ["404", "TREE_NOT_FOUND", "Tree doesn't exist"],
              ["404", "EXTENSION_NOT_FOUND", "Extension not loaded"],
              ["404", "ORCHESTRATOR_NOT_FOUND", "No orchestrator registered"],
              ["404", "PEER_NOT_FOUND", "Land not found in network"],
              ["409", "ORCHESTRATOR_LOCKED", "Operation already running"],
              ["409", "RESOURCE_CONFLICT", "State prevents this action"],
              ["413", "DOCUMENT_SIZE_EXCEEDED", "Document approaching 16MB"],
              ["413", "CASCADE_DEPTH_EXCEEDED", "Signal exceeded cascadeMaxDepth"],
              ["413", "UPLOAD_TOO_LARGE", "Exceeds maxUploadBytes"],
              ["415", "UPLOAD_MIME_REJECTED", "MIME type not in allowedMimeTypes"],
              ["429", "RATE_LIMITED", "Too many requests"],
              ["429", "CASCADE_REJECTED", "Rate limited or payload too large"],
              ["500", "INTERNAL", "Unexpected kernel error"],
              ["500", "TIMEOUT", "Operation timed out"],
              ["500", "HOOK_TIMEOUT", "Hook handler hung"],
              ["500", "HOOK_CANCELLED", "Hook cancelled operation"],
              ["502", "PEER_UNREACHABLE", "Land found but can't connect"],
              ["503", "LLM_TIMEOUT", "LLM call timed out"],
              ["503", "LLM_FAILED", "LLM call failed"],
              ["503", "LLM_NOT_CONFIGURED", "No LLM available"],
              ["503", "TREE_DORMANT", "Tree circuit breaker tripped"],
            ].map(([http, code, desc]) => (
              <div key={code} style={{
                display: "flex", gap: 12, padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                alignItems: "baseline",
              }}>
                <span style={{color: "rgba(255,255,255,0.3)", minWidth: 30, fontFamily: "monospace"}}>{http}</span>
                <code style={{color: "#4ade80", minWidth: 200}}>{code}</code>
                <span style={{color: "#666", flex: 1}}>{desc}</span>
              </div>
            ))}
          </div>

          <P><strong>Cascade Statuses</strong> (not HTTP errors, used in .flow results):</P>
          <div style={{fontSize: "0.8rem", marginBottom: 32}}>
            {[
              ["succeeded", "#4ade80", "Handler processed the signal"],
              ["failed", "#f87171", "Handler encountered an error"],
              ["rejected", "#fbbf24", "Handler intentionally declined"],
              ["queued", "#60a5fa", "Accepted, processing deferred"],
              ["partial", "#c084fc", "Some handlers succeeded, others did not"],
              ["awaiting", "#94a3b8", "Response expected, timeout transitions to failed"],
            ].map(([status, color, desc]) => (
              <div key={status} style={{
                display: "flex", gap: 12, padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                alignItems: "baseline",
              }}>
                <code style={{color, minWidth: 100}}>{status}</code>
                <span style={{color: "#666"}}>{desc}</span>
              </div>
            ))}
          </div>

          <P><strong>WebSocket Events</strong> (kernel-emitted only, extensions define their own):</P>
          <div style={{fontSize: "0.8rem"}}>
            {[
              ["chatResponse", "AI response chunk"],
              ["chatError", "AI error"],
              ["chatCancelled", "Request cancelled"],
              ["toolResult", "MCP tool result"],
              ["placeResult", "Place operation result"],
              ["modeSwitched", "AI mode changed"],
              ["treeChanged", "Tree structure modified"],
              ["registered", "User registered on socket"],
              ["navigatorSession", "Active navigator info"],
              ["availableModes", "Modes for current position"],
              ["conversationCleared", "Conversation reset"],
              ["navigate", "Navigation event"],
              ["reload", "Client should reload"],
            ].map(([evt, desc]) => (
              <div key={evt} style={{
                display: "flex", gap: 12, padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)",
                alignItems: "baseline",
              }}>
                <code style={{color: "#60a5fa", minWidth: 180}}>{evt}</code>
                <span style={{color: "#666"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 19. LICENSE */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">License</h2>
          <P>
            The seed is AGPL-3.0. Run it, modify it, build on it. If you modify the seed and run it
            as a service, share your seed modifications. Extensions are separate works that interact
            through the defined API. Extension authors choose their own license. The seed license
            does not infect extensions.
          </P>
        </div>
      </section>

      {/* ── LINKS ── */}
      <section className="lp-section lp-section-alt" style={{paddingTop: 40, paddingBottom: 40}}>
        <div className="lp-container" style={{textAlign: "center"}}>
          <div style={{display: "flex", gap: 16, justifyContent: "center", flexWrap: "wrap"}}>
            <a className="lp-btn lp-btn-secondary" href="/">Home</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/flow">The Flow</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Horizon</a>
            <a className="lp-btn lp-btn-secondary" href="https://github.com/Tabors-Site/Tree">GitHub</a>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* INTERNAL TUNING */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section" style={{paddingTop: 40}}>
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title" style={{fontSize: "1.2rem", color: "rgba(255,255,255,0.6)"}}>Internal Tuning</h2>
          <P style={{color: "rgba(255,255,255,0.45)", fontSize: "0.85rem"}}>
            Advanced operators can adjust these values via <code>treeos config set</code>.
            Most lands never need to. Defaults are safe.
          </P>
          <div style={{fontSize: "0.75rem", color: "rgba(255,255,255,0.4)"}}>
            {[
              ["socketMaxBufferSize", "1048576", "Max WS message size (bytes)"],
              ["socketPingTimeout", "30000", "WS ping timeout (ms)"],
              ["socketPingInterval", "25000", "WS ping interval (ms)"],
              ["socketConnectTimeout", "10000", "WS connection timeout (ms)"],
              ["maxConnectionsPerIp", "20", "Per-IP WS connection cap"],
              ["llmClientCacheTtl", "300", "User LLM client cache lifetime (seconds)"],
              ["canopyProxyCacheTtl", "60", "Canopy proxy client cache lifetime (seconds)"],
              ["apiOrchestrationTimeout", "1140000", "API request timeout (ms)"],
              ["canopyHeartbeatInterval", "300000", "Heartbeat frequency (ms)"],
              ["canopyDegradedThreshold", "2", "Failed heartbeats before degraded"],
              ["canopyUnreachableThreshold", "12", "Failed heartbeats before unreachable"],
              ["canopyDeadThresholdDays", "30", "Days before dead peer cleanup"],
              ["canopyOutboxInterval", "60000", "Outbox processing frequency (ms)"],
              ["canopyMaxRetries", "5", "Event delivery retries"],
              ["canopyEventDeliveryTimeout", "15000", "Per-event delivery timeout (ms)"],
              ["canopyDestLimitPerCycle", "10", "Events per destination per cycle"],
              ["orchestratorLockTtlMs", "1800000", "Lock TTL before auto-expire (ms)"],
              ["lockSweepInterval", "300000", "Lock cleanup sweep (ms)"],
              ["uploadCleanupInterval", "21600000", "Upload cleanup frequency (ms)"],
              ["uploadGracePeriodMs", "3600000", "File age before deletion (ms)"],
              ["uploadCleanupBatchSize", "1000", "Max files deleted per cleanup cycle (10-50000)"],
              ["retentionCleanupInterval", "86400000", "Retention job frequency (ms)"],
              ["cascadeCleanupInterval", "21600000", "Cascade result cleanup frequency (ms)"],
              ["dnsLookupTimeout", "5000", "DNS resolution timeout for custom LLM URLs (ms)"],
              ["mcpConnectTimeout", "10000", "MCP client connection timeout (ms)"],
              ["mcpStaleTimeout", "3600000", "MCP client idle timeout before sweep (ms)"],
              ["orchestratorInitTimeout", "30000", "Background pipeline init timeout (ms)"],
              ["hookTimeoutMs", "5000", "Per-hook handler timeout (ms)"],
              ["hookMaxHandlers", "100", "Max handlers per hook name"],
              ["hookCircuitThreshold", "5", "Consecutive failures before hook auto-disable"],
              ["hookCircuitHalfOpenMs", "300000", "Tripped handler recovery test delay (ms)"],
              ["hookChainTimeoutMs", "15000", "Cumulative timeout for sequential hook chains (ms)"],
              ["ancestorCacheMaxEntries", "50000", "Max cached ancestor chains"],
              ["ancestorCacheMaxDepth", "100", "Parent chain depth limit (10-500)"],
              ["maxContributorsPerNode", "500", "Max contributors[] per node"],
              ["metadataMaxNestingDepth", "5", "Max metadata nesting depth (2-20)"],
              ["mcpConnectRetries", "2", "MCP reconnect attempts for pipelines (0-10)"],
              ["contributionQueryLimit", "5000", "Max contribution docs per query (1-50000)"],
              ["noteQueryLimit", "5000", "Max notes per query (1-50000)"],
              ["noteSearchLimit", "500", "Max notes per search (1-10000)"],
              ["subtreeNodeCap", "10000", "Max nodes in subtree traversal (100-100000)"],
              ["circuitFlowScanLimit", "5000", "Max cascade results scanned per health check"],
              ["treeAncestorDepth", "50", "Max ancestors in context build (5-200)"],
              ["treeContributionsPerNode", "500", "Max contributions per node in context (10-10000)"],
              ["treeNotesPerNode", "100", "Max notes per node in context (10-1000)"],
              ["treeMaxChildrenResolve", "200", "Max children resolved per node (10-1000)"],
              ["treeAllDataDepth", "20", "Max depth for getAllNodeData (5-50)"],
              ["metadataNamespaceMaxBytes", "524288", "Per-namespace metadata cap in bytes (1KB-2MB)"],
            ].map(([key, def, desc]) => (
              <div key={key} style={{
                display: "flex", gap: 8, padding: "3px 0",
                borderBottom: "1px solid rgba(255,255,255,0.02)",
              }}>
                <code style={{color: "rgba(255,255,255,0.5)", minWidth: 220, fontSize: "0.7rem"}}>{key}</code>
                <span style={{minWidth: 80, fontFamily: "monospace", color: "rgba(255,255,255,0.3)"}}>{def}</span>
                <span style={{color: "rgba(255,255,255,0.4)"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <footer className="lp-footer">
        <div className="lp-container">
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

export default Guide;
