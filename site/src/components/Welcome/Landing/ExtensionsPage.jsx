import "./LandingPage.css";

const ExtensionsPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "60vh"}}>
        <div className="lp-hero-inner">
          <h1 className="lp-title">Extensions</h1>
          <p className="lp-subtitle">How the tree grows.</p>
          <p className="lp-tagline">
            Every capability beyond the seed is an extension. AI modes, MCP tools,
            HTML rendering, billing, fitness coaching, backup, gateway channels.
            Install what you need. Remove what you don't. Build your own.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
          </div>
        </div>
      </section>

      {/* ── MANIFEST + INIT ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The Contract</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every extension has two files. A manifest that declares what it needs and what it provides.
            An index that exports an init function. The kernel reads the manifest first, calls init second.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>manifest.js</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                <code>needs</code>: models, services, other extensions (with semver constraints).
                <code>optional</code>: graceful degradation if missing.
                <code>provides</code>: CLI commands, env vars, energy actions, session types, indexes.
                The loader reads the manifest before calling any code. Unmet needs = extension skipped,
                logged, and the land boots without it.
              </p>
            </div>
            <div className="lp-card">
              <h3>init(core)</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The entry point. Receives the core services bundle. Can return any combination of:
                <code>router</code> (HTTP routes at /api/v1),
                <code>tools</code> (MCP tools for the AI),
                <code>jobs</code> (background tasks),
                <code>pageRouter</code> (pages at /),
                <code>exports</code> (for other extensions to import).
                Registers hooks, modes, orchestrators, socket handlers, auth strategies through core.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── LOADER ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The Loader</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            At boot, the loader brings every extension online in the right order.
            Dependencies are resolved automatically. A topological sort guarantees
            that if extension B depends on extension A, A loads first.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <div className="lp-step-content">
                <h4>Discover</h4>
                <p>Scan <code>extensions/</code> for directories with <code>manifest.js</code>. Skip disabled extensions (configurable via .config, env, or file). Validate manifest fields. Check required env vars.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <div className="lp-step-content">
                <h4>Resolve</h4>
                <p>Check needs: models, services, other extensions with semver constraints. Topological sort so dependencies load first. Extensions with unmet requirements are skipped. The rest proceed.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <div className="lp-step-content">
                <h4>Initialize</h4>
                <p>Call <code>init(core)</code> with the scoped services bundle. Extensions register modes, hooks, tools, socket handlers. They return routes, tools, jobs, and exports. Each extension receives only the services it declared.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">4</div>
              <div className="lp-step-content">
                <h4>Wire</h4>
                <p>Mount routes at <code>/api/v1</code>. Register MCP tools with ownership tracking. Mount page routes. Start background jobs. Run schema migrations. Ensure extension indexes. Sync state to .extensions system node.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── BUNDLES ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Bundles</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Extensions ship as bundles. A bundle is a meta-extension whose manifest lists other extensions
            as dependencies. Install the bundle and the loader resolves everything. Remove one extension
            and the rest keep working. Four bundles cover the major capabilities.
          </p>

          <div style={{maxWidth: 720, margin: "0 auto"}}>
            <div style={{marginBottom: 40}}>
              <h3 style={{color: "#4ade80", fontSize: "1.05rem", marginBottom: 8}}>treeos-cascade <span style={{color: "rgba(255,255,255,0.3)", fontWeight: 400}}>8 extensions</span></h3>
              <p style={{color: "rgba(255,255,255,0.55)", lineHeight: 1.8, fontSize: "0.88rem"}}>
                The nervous system. The kernel fires one hook when content is written at a cascade-enabled
                node. Eight extensions turn that hook into a full signal network. Propagation moves signals
                through children and across lands. Perspective filtering lets each node declare what it
                drinks. Sealed transport encrypts signals for cross-land delivery. Long memory writes permanent
                traces. Codebook compresses repeated patterns into shared vocabulary. Gap detection surfaces
                missing capabilities. Pulse monitors health. Flow visualizes movement.
              </p>
              <p style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem", marginTop: 8}}>
                propagation, perspective-filter, sealed-transport, codebook, gap-detection, long-memory, pulse, flow
              </p>
            </div>

            <div style={{marginBottom: 40}}>
              <h3 style={{color: "#4ade80", fontSize: "1.05rem", marginBottom: 8}}>treeos-connect <span style={{color: "rgba(255,255,255,0.3)", fontWeight: 400}}>8 extensions</span></h3>
              <p style={{color: "rgba(255,255,255,0.55)", lineHeight: 1.8, fontSize: "0.88rem"}}>
                The rain. External channels open the clouds. Discord messages become tree interactions.
                Telegram chats become conversations at specific nodes. Email through any SMTP server. SMS
                through Twilio. Slack where teams already work. Matrix for sovereignty. X for public
                discourse. Reddit for community knowledge. Each channel type registers with the gateway core
                and gets user resolution, tree access, energy gating, and queue management for free.
              </p>
              <p style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem", marginTop: 8}}>
                gateway, gateway-telegram, gateway-discord, gateway-email, gateway-sms, gateway-slack, gateway-matrix, gateway-webhook
              </p>
            </div>

            <div style={{marginBottom: 40}}>
              <h3 style={{color: "#4ade80", fontSize: "1.05rem", marginBottom: 8}}>treeos-intelligence <span style={{color: "rgba(255,255,255,0.3)", fontWeight: 400}}>11 extensions</span></h3>
              <p style={{color: "rgba(255,255,255,0.55)", lineHeight: 1.8, fontSize: "0.88rem"}}>
                Self-awareness and autonomy. Tree-compress carries meaning upward and trims what has been
                absorbed. Contradiction surfaces conflicting truths across branches. The inverse tree builds
                a model of each user from their behavior. Evolution tracks which structures work and teaches
                the AI to recommend them. Embed gives every note a vector so semantically related content
                finds each other. Scout runs fast structural passes. Explore navigates branches the way
                Claude Code navigates a codebase. Trace follows concepts through the tree. Boundary detects
                where the tree's knowledge ends. Phase detects whether the user is gathering or producing.
                Intent is the capstone. It reads from every other intelligence extension and synthesizes
                autonomous actions the tree takes on its own.
              </p>
              <p style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem", marginTop: 8}}>
                tree-compress, contradiction, inverse-tree, evolution, intent, embed, scout, explore, trace, boundary, phase
              </p>
            </div>

            <div style={{marginBottom: 12}}>
              <h3 style={{color: "#4ade80", fontSize: "1.05rem", marginBottom: 8}}>treeos-maintenance <span style={{color: "rgba(255,255,255,0.3)", fontWeight: 400}}>4 extensions</span></h3>
              <p style={{color: "rgba(255,255,255,0.55)", lineHeight: 1.8, fontSize: "0.88rem"}}>
                Hygiene and reorganization. Prune identifies dead nodes, absorbs essentials into parents,
                and trims. Reroot builds a semantic similarity graph and proposes moves that minimize distance
                between related nodes. Changelog narrates why the tree looks the way it does. Root-hold
                monitors coherence between the tree's thesis and its actual content, surfacing drift before
                branches grow away from purpose.
              </p>
              <p style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem", marginTop: 8}}>
                prune, reroot, changelog, root-hold
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FIVE REGISTRIES ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Five Registries</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Same pattern across all five. Extensions register. The kernel resolves.
            Failure falls back to the kernel, never to silence.
          </p>
          <div style={{maxWidth: 700, margin: "0 auto"}}>
            {[
              ["Hooks", "Lifecycle event handlers. 27 kernel hooks. Extensions fire their own with extName:hookName convention. before hooks cancel. after hooks react. Sequential hooks build on each other."],
              ["Modes", "AI conversation modes. How the AI thinks at each position. Extensions register modes during init(). The kernel resolves which mode fires based on position, intent, and per-node overrides."],
              ["Orchestrators", "Conversation flow replacements. The entire chat/place/query pipeline is an orchestrator. Replace it and you control every AI interaction on the land."],
              ["Socket Handlers", "WebSocket event handlers. Extensions add real-time features without touching the kernel's websocket code. The dashboard, recent-roots, and notification extensions all use this."],
              ["Auth Strategies", "Authentication methods. JWT is built-in. API keys, share tokens, public access are all extensions that register auth strategies. The kernel tries each one in order."],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", gap: 16, padding: "14px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <span style={{color: "#4ade80", minWidth: 140, fontSize: "0.9rem", fontWeight: 600}}>{name}</span>
                <span style={{color: "#888", fontSize: "0.85rem", lineHeight: 1.7}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SPATIAL SCOPING ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Spatial Scoping</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Position determines capability. Block an extension at a node and it loses all power
            at that node and every descendant. Tools disappear. Hooks stop firing. Modes don't resolve.
            Metadata writes are refused.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>Global (opt-out)</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Active everywhere by default. <code>ext-block shell</code> at a node removes it there
                and all descendants. Good for most extensions: codebook, evolution, pulse, understanding.
                You want them everywhere.
              </p>
            </div>
            <div className="lp-card">
              <h3>Confined (opt-in)</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Active nowhere by default. <code>ext-allow solana</code> at a node activates it there
                and all descendants. Good for dangerous or specialized extensions: shell, solana, scripts.
                You want them only where they belong. Manifest declares <code>scope: "confined"</code>.
              </p>
            </div>
          </div>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr", marginTop: 8}}>
            <div className="lp-card">
              <h3>Restricted</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                <code>ext-restrict food read</code>.
                The extension keeps its read-only tools. Write tools are filtered out.
                Hooks still fire. Metadata reads work. A middle ground between full access and blocked.
              </p>
            </div>
            <div className="lp-card">
              <h3>Position-Aware Help</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The CLI help menu updates at every position. Run <code>help</code> at /Health/Fitness
                and you see fitness commands. Navigate to /Finance and solana commands appear. The help
                menu shows exactly what the AI can do here. Same commands. Same tools. Your view matches
                the AI's view.
              </p>
            </div>
          </div>
          <p className="lp-section-sub" style={{marginTop: 24, color: "rgba(255,255,255,0.4)"}}>
            Navigate somewhere and the capability surface changes. The tree reshapes around where you stand.
            An allowed confined extension can still be blocked further down. Allow solana at /Finance.
            Block it at /Finance/ReadOnly. The resolution chain handles both.
          </p>
        </div>
      </section>

      {/* ── CROSS-EXTENSION COMMUNICATION ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">How Extensions Talk to Each Other</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Extensions are decoupled. They never import each other directly.
            Three patterns for communication.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <div className="lp-card">
              <h3>Hooks</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Pub/sub. Extension A fires <code>core.hooks.run("a:afterProcess", data)</code>.
                Extension B listens with <code>core.hooks.register("a:afterProcess", handler, "b")</code>.
                Neither imports the other. The kernel is the bus.
              </p>
            </div>
            <div className="lp-card">
              <h3>Exports</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Direct call. Extension A returns <code>exports: {"{"} doSomething {"}"}</code> from init.
                Extension B calls <code>getExtension("a")?.exports?.doSomething()</code>.
                Dynamic import with try/catch. Graceful if A isn't installed.
              </p>
            </div>
            <div className="lp-card">
              <h3>Metadata</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Shared state on nodes. Extension A writes <code>metadata.a</code>.
                Extension B reads <code>metadata.a</code> via getExtMeta.
                The node is the shared memory. The Map is the address space.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── OS CONCEPT ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">An Operating System Is Just Extensions Working Together</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The seed doesn't ship an operating system. It ships the kernel that operating systems
            are built from. An OS emerges when enough extensions depend on each other that a coherent
            experience forms. AI modes, a conversation orchestrator, a data layer, metering, an interface,
            external channels. Each one independent. Together they form something whole.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "rgba(255,255,255,0.4)"}}>
            Swap any of them and you get a different OS. A medical OS with triage and diagnosis modes.
            A coding OS with architect and review modes. A research OS with citation and synthesis modes.
          </p>
          <p className="lp-section-sub" style={{fontStyle: "italic", color: "rgba(255,255,255,0.3)"}}>
            Thirty-one extensions across four bundles. Seventy-two CLI commands.
            All growing from twelve schema fields and a metadata Map.
            Enough extensions built on a kernel eventually form an operating system.
            Operating systems are good starting grounds for people to build off of.
          </p>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/build">Developer Reference</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Browse Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
          </div>
        </div>
      </section>

      {/* ── CONTRIBUTE ── */}
      <section className="lp-section">
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">Start Building</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Check out extensions built so far at <a href="https://horizon.treeos.ai" style={{color: "#4ade80", textDecoration: "none"}}>horizon.treeos.ai</a> and
            publish your own to start growing. Every extension is a piece contributed toward the future
            of AI infrastructure. There are many things to be built off the kernel.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "rgba(255,255,255,0.4)"}}>
            Open code. Open doors. Resilient. Decentralized. This was designed to be held back by no one.
            We can work together on this.
          </p>
          <p className="lp-section-sub" style={{color: "rgba(255,255,255,0.3)", fontSize: "0.85rem"}}>
            The Horizon at horizon.treeos.ai is one place to discover lands and share extensions.
            Anyone can host their own Horizon. Lands connect peer to peer. The Horizon is
            just discovery. But building together in one place is how communities grow.
          </p>
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

export default ExtensionsPage;
