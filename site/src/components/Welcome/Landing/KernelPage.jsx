import "./LandingPage.css";

const KernelPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">⚙️</div>
          <h1 className="lp-title">The Seed</h1>
          <p className="lp-subtitle">What runs when everything else is stripped away.</p>
          <p className="lp-tagline">
            The kernel is called the seed. You plant it. It grows trees. Two schemas,
            a conversation loop, a hook system, a cascade engine, and an extension loader.
            Remove every extension and the seed still boots. It defines the data contract
            that extensions build on and the resolution chains that determine what happens
            at every position in the tree.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/">Back to TreeOS</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Full Guide</a>
          </div>
        </div>
      </section>

      {/* ── SCHEMAS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Two Schemas</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The entire data model is two documents. Everything an extension needs to store
            goes in the metadata Map. The schemas never change. Ever.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>Node</h3>
              <div style={{fontFamily: "monospace", fontSize: "0.85rem", color: "#999", lineHeight: 2}}>
                _id, name, type, status<br/>
                dateCreated, llmDefault, visibility<br/>
                children[], parent<br/>
                rootOwner, contributors[]<br/>
                systemRole<br/>
                <span style={{color: "#4ade80"}}>metadata (Map)</span>
              </div>
              <p style={{marginTop: 12, fontSize: "0.85rem", color: "#666"}}>
                12 fields. Type is free-form (custom types allowed). Status is active, completed, or trimmed.
                Extensions store all their data in metadata under their name. Values, prestige history,
                schedules, tool configs, extension scoping, all of it lives in the Map.
              </p>
            </div>
            <div className="lp-card">
              <h3>User</h3>
              <div style={{fontFamily: "monospace", fontSize: "0.85rem", color: "#999", lineHeight: 2}}>
                _id, username, password<br/>
                roots[], llmDefault<br/>
                isAdmin, isRemote, homeLand<br/>
                <span style={{color: "#4ade80"}}>metadata (Map)</span>
              </div>
              <p style={{marginTop: 12, fontSize: "0.85rem", color: "#666"}}>
                8 fields. One default LLM connection. Extensions store energy budgets, API keys,
                LLM slot assignments, storage usage, and preferences in metadata.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONVERSATION LOOP ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The Conversation Loop</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every AI interaction goes through the same loop. Mode determines the system prompt
            and available tools. The loop calls the LLM, executes tool calls, and repeats until
            the LLM responds without tools or hits the iteration cap.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <div className="lp-step-content">
                <h4>Resolve LLM</h4>
                <p>Walk the resolution chain: extension slot on tree, tree default, extension slot on user, user default. First match wins. Any OpenAI-compatible endpoint works.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <div className="lp-step-content">
                <h4>Resolve Tools</h4>
                <p>Three layers: mode base tools, extension-injected tools, per-node config (allowed/blocked). Then spatial extension scoping filters out tools from blocked or restricted extensions. The AI only sees what's permitted at this position.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <div className="lp-step-content">
                <h4>Build Prompt</h4>
                <p>The active mode's <code>buildSystemPrompt()</code> generates the system message with user context, tree position, and timezone. Extensions inject context via the enrichContext hook.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">4</div>
              <div className="lp-step-content">
                <h4>Tool Loop</h4>
                <p>Send to LLM. If it returns tool calls, execute them via MCP, append results, send again. Repeat until the LLM responds with text or hits maxToolIterations (default 15). Abort signal checked between iterations.</p>
              </div>
            </div>
          </div>
          <p className="lp-section-sub" style={{marginTop: 20}}>
            Extensions never call the loop directly. They use <code>runChat()</code> (single message, persistent session)
            or <code>OrchestratorRuntime</code> (multi-step chain). One call handles MCP connection,
            session management, Chat tracking, abort propagation, and cleanup.
          </p>
        </div>
      </section>

      {/* ── HOOKS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Hook System</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            An open pub/sub bus. The kernel fires events. Extensions listen. Extensions can also
            fire their own events for other extensions to listen to. Any hook name is valid.
            No whitelist. Typos are detected and warned, not blocked.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <div className="lp-card">
              <h3>Before Hooks (7)</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Sequential. Can modify data. Can cancel. 5s timeout per handler.
              </p>
              <div style={{fontFamily: "monospace", fontSize: "0.8rem", color: "#555", marginTop: 12, lineHeight: 1.8}}>
                beforeNote<br/>
                beforeNodeCreate<br/>
                beforeStatusChange<br/>
                beforeNodeDelete<br/>
                beforeContribution<br/>
                beforeRegister<br/>
                beforeResponse
              </div>
            </div>
            <div className="lp-card">
              <h3>After Hooks (12)</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Parallel, fire-and-forget. Errors logged, never block.
              </p>
              <div style={{fontFamily: "monospace", fontSize: "0.8rem", color: "#555", marginTop: 12, lineHeight: 1.8}}>
                afterNote<br/>
                afterNodeCreate<br/>
                afterStatusChange<br/>
                afterRegister<br/>
                afterLLMCall<br/>
                afterToolCall<br/>
                afterSessionCreate<br/>
                afterSessionEnd<br/>
                afterNavigate<br/>
                afterMetadataWrite<br/>
                afterScopeChange<br/>
                afterBoot
              </div>
            </div>
            <div className="lp-card">
              <h3>Sequential (4)</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Return values captured. Handlers can read each other's additions.
              </p>
              <div style={{fontFamily: "monospace", fontSize: "0.8rem", color: "#555", marginTop: 12, lineHeight: 1.8}}>
                enrichContext<br/>
                beforeLLMCall<br/>
                beforeToolCall<br/>
                <span style={{color: "#4ade80"}}>onCascade</span>
              </div>
            </div>
          </div>
          <p className="lp-section-sub" style={{marginTop: 20}}>
            Extensions fire their own hooks with <code>extName:hookName</code> convention.
            The gateway extension fires <code>gateway:beforeDispatch</code>. Other extensions listen.
            Spatial scoping filters: if an extension is blocked at a node, its hook handlers
            are skipped for operations on that node.
          </p>
        </div>
      </section>

      {/* ── EXTENSION LOADER ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Extension Loader</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            At boot, the loader scans extension directories, reads manifests, validates
            dependencies, resolves load order (topological sort), and wires everything
            into the land. Extensions only receive the services they declared.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <div className="lp-step-content">
                <h4>Discover</h4>
                <p>Scan <code>extensions/</code> for directories with <code>manifest.js</code>. Skip disabled extensions (from env, file, or DB config). Validate manifest fields.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <div className="lp-step-content">
                <h4>Resolve</h4>
                <p>Check needs (models, services, middleware, extensions with semver constraints). Check optional deps. Topological sort so dependencies load first. Skip extensions with unmet requirements.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <div className="lp-step-content">
                <h4>Initialize</h4>
                <p>Call each extension's <code>init(core)</code> with a scoped services bundle. Extensions register modes, hooks, and set <code>core.energy</code> or other services. Return router, tools, jobs, exports.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">4</div>
              <div className="lp-step-content">
                <h4>Wire</h4>
                <p>Mount routes at <code>/api/v1</code>. Register MCP tools with ownership tracking. Register page routes. Start background jobs. Run schema migrations. Sync extension state to the .extensions system node.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── RESOLUTION CHAINS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Four Resolution Chains</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every operation at a node goes through resolution chains that determine what the AI
            can do and how it thinks. Each chain walks the parent hierarchy and applies layered rules.
            This is what makes position determine capability.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>1. Extension Scope</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Is this extension active, restricted, or blocked here?
                Walk parent chain, accumulate <code>metadata.extensions.blocked[]</code> and <code>restricted{}</code>.
                Blocked extensions lose all capabilities. Restricted extensions keep read-only tools.
              </p>
            </div>
            <div className="lp-card">
              <h3>2. Tool Scope</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                What tools does the AI have?
                Start with mode base tools. Add extension-injected tools. Apply per-node <code>metadata.tools.allowed/blocked</code>.
                Filter by extension scope. The AI sees only what survives all layers.
              </p>
            </div>
            <div className="lp-card">
              <h3>3. Mode Resolution</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                How does the AI think?
                Check <code>metadata.modes[intent]</code> for per-node override. Skip if owning extension is blocked.
                Fall back to default mapping (<code>tree:respond</code>). Then bigMode default.
              </p>
            </div>
            <div className="lp-card">
              <h3>4. LLM Resolution</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Which model runs?
                Extension slot on tree, tree default, extension slot on user, user default.
                First match wins. Failover chain tried on failure.
              </p>
            </div>
          </div>
          <p className="lp-section-sub" style={{marginTop: 20}}>
            Navigate to a different node. All four chains re-resolve. Different tools appear.
            Different mode fires. Different model runs. The tree reshapes around where you stand.
          </p>
        </div>
      </section>

      {/* ── CASCADE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Cascade</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Structure without communication is a filing cabinet. Cascade is what makes
            the tree alive. When content is written at a node marked for cascade, the kernel
            announces it. Extensions propagate, react, and deliver signals to other nodes
            and other lands. Every signal produces a visible result.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>Local Origin</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                A note is written at a node with <code>metadata.cascade.enabled = true</code>.
                The kernel checks two booleans: is cascade enabled on this node? Is <code>cascadeEnabled</code> true
                in .config? If both yes, fire <code>onCascade</code>. The first event is always local.
                Somebody wrote something at a position marked for cascade.
              </p>
            </div>
            <div className="lp-card">
              <h3>External Delivery</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Extensions call <code>deliverCascade</code> to send signals to other nodes,
                children, siblings, or remote lands via Canopy. The kernel never blocks inbound.
                Always accepts. Always writes a result to <code>.flow</code>. Extensions decide
                what to do when a signal arrives.
              </p>
            </div>
          </div>
          <div style={{maxWidth: 600, margin: "24px auto 0"}}>
            <div style={{marginBottom: 12, fontSize: "0.9rem", color: "#aaa", fontWeight: 600}}>Result Shape</div>
            <div style={{fontFamily: "monospace", fontSize: "0.85rem", color: "#888", lineHeight: 2}}>
              {"{ status, source, payload, timestamp, signalId, extName }"}
            </div>
            <div style={{marginTop: 8, fontSize: "0.85rem", color: "#666"}}>
              Six statuses: <strong style={{color: "#4ade80"}}>succeeded</strong>,{" "}
              <strong style={{color: "#f87171"}}>failed</strong>,{" "}
              <strong style={{color: "#fbbf24"}}>rejected</strong>,{" "}
              <strong style={{color: "#60a5fa"}}>queued</strong>,{" "}
              <strong style={{color: "#c084fc"}}>partial</strong>,{" "}
              <strong style={{color: "#94a3b8"}}>awaiting</strong>.
              None terminal. None lock the channel. They are labels on what happened,
              not permissions for what can happen next.
            </div>
          </div>
          <p className="lp-section-sub" style={{marginTop: 20}}>
            The kernel has four primitives. <strong style={{color: "#e5e5e5"}}>Structure</strong>: two schemas, nodes in hierarchies.{" "}
            <strong style={{color: "#e5e5e5"}}>Intelligence</strong>: the conversation loop, resolution chains.{" "}
            <strong style={{color: "#e5e5e5"}}>Extensibility</strong>: the loader, hooks, pub-sub.{" "}
            <strong style={{color: "#e5e5e5"}}>Communication</strong>: cascade, .flow, visible results.
            Everything else is emergent behavior from these four interacting.
          </p>
          <div style={{textAlign: "center", marginTop: 20}}>
            <a href="/cascade" style={{
              color: "#60a5fa", fontSize: "0.95rem", fontWeight: 600,
              textDecoration: "none", borderBottom: "1px solid rgba(96, 165, 250, 0.3)",
              paddingBottom: 2,
            }}>Deep dive: Cascade and the Water Cycle</a>
          </div>
        </div>
      </section>

      {/* ── SYSTEM NODES ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">System Nodes</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            When a land boots for the first time, the kernel creates six system nodes.
            They hold infrastructure state, not user content.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>root</div>
              <div className="lp-step-content">
                <h4>Land Root</h4>
                <p>The top-level node. Parent of all trees and system nodes. <code>rootOwner: "SYSTEM"</code>.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>.id</div>
              <div className="lp-step-content">
                <h4>.identity</h4>
                <p>Land UUID, domain, Ed25519 public key for Canopy federation signing. Set once at boot.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>.cfg</div>
              <div className="lp-step-content">
                <h4>.config</h4>
                <p>All runtime configuration as metadata keys. Readable and writable via CLI, API, or the land-manager AI.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>.p</div>
              <div className="lp-step-content">
                <h4>.peers</h4>
                <p>Canopy federation peer list. Children are peer land records with status and heartbeat history.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>.ext</div>
              <div className="lp-step-content">
                <h4>.extensions</h4>
                <p>Extension registry. Each loaded extension is a child node with version and schema version for migrations.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>.f</div>
              <div className="lp-step-content">
                <h4>.flow</h4>
                <p>Cascade result store. Holds signal outcomes keyed by signalId. Cleaned by resultTTL. The land's short-term memory of what moved and what happened.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONFIG KEYS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Kernel Config</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every tunable value in the kernel. Set from the CLI, the API, or through the land-manager AI. No code changes. No restarts.
          </p>
          <div style={{maxWidth: 700, margin: "0 auto"}}>
            {[
              ["LAND_NAME", "Display name", "My Land"],
              ["landUrl", "Land URL for SSRF protection and headers", "auto"],
              ["llmTimeout", "Seconds per LLM API call", "900"],
              ["llmMaxRetries", "Retry count on 429/500", "3"],
              ["maxToolIterations", "Tool calls per message", "15"],
              ["maxConversationMessages", "Context window size", "30"],
              ["defaultModel", "Fallback LLM model", ""],
              ["noteMaxChars", "Max characters per note", "5000"],
              ["treeSummaryMaxDepth", "How deep AI sees the tree", "4"],
              ["treeSummaryMaxNodes", "How many nodes AI sees", "60"],
              ["carryMessages", "Messages carried across mode switch", "4"],
              ["sessionTTL", "Session idle timeout (seconds)", "900"],
              ["staleSessionTimeout", "Stale session cleanup (seconds)", "1800"],
              ["maxSessions", "Max concurrent sessions", "10000"],
              ["chatRetentionDays", "Auto-delete chats after N days", "90"],
              ["contributionRetentionDays", "Auto-delete contributions after N days", "365"],
              ["canopyEventRetentionDays", "Canopy event cleanup (canopy owns this)", "30"],
              ["timezone", "Land timezone for AI prompts", "auto"],
              ["disabledExtensions", "Extensions to skip on boot", "[]"],
              ["cascadeEnabled", "Enable cascade signals on content writes", "false"],
              ["resultTTL", "Seconds before cascade results cleaned from .flow", "604800"],
              ["awaitingTimeout", "Seconds before awaiting status becomes failed", "300"],
              ["cascadeMaxDepth", "Max propagation depth per signal", "50"],
              ["cascadeMaxPayloadBytes", "Max signal payload size", "51200"],
              ["cascadeRateLimit", "Max signals per node per minute", "60"],
              ["uploadEnabled", "Master switch for uploads", "true"],
              ["maxUploadBytes", "Hard ceiling per upload", "104857600"],
              ["allowedMimeTypes", "MIME prefix filter (null = all)", "null"],
            ].map(([key, desc, def]) => (
              <div key={key} style={{
                display: "flex", justifyContent: "space-between", alignItems: "center",
                padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)",
                gap: 12,
              }}>
                <code style={{color: "#4ade80", fontSize: "0.85rem", minWidth: 220}}>{key}</code>
                <span style={{color: "#888", fontSize: "0.85rem", flex: 1}}>{desc}</span>
                {def && <span style={{color: "#555", fontSize: "0.8rem", fontFamily: "monospace"}}>{def}</span>}
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── PROTECTION ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Safety</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The kernel protects itself from extensions, from runaway AI, and from time.
          </p>
          <div style={{maxWidth: 600, margin: "0 auto", fontSize: "0.9rem"}}>
            {[
              ["Hook timeout", "5s per handler. Hanging handlers killed and logged."],
              ["Hook cap", "100 handlers per hook. Flooding rejected."],
              ["Circuit breaker", "5 consecutive failures auto-disables the handler."],
              ["Metadata guard", "Blocked extensions can't write to nodes."],
              ["Session cap", "10K max with oldest-first eviction."],
              ["Depth limits", "50 for status cascade, 100 for auth traversal."],
              ["Name validation", "No HTML, no dots, no slashes, max 150 chars."],
              ["Dependent check", "Can't uninstall if other extensions depend on it."],
              ["Checksum verification", "SHA256 verified on extension install."],
              ["Semver constraints", "Dependencies declare version requirements."],
              ["Never block inbound", "Cascade signals always accepted. Always write a result to .flow."],
              ["Cascade depth limit", "cascadeMaxDepth (50). Exceeding writes rejected result. Prevents loops."],
              ["Upload cleanup", "Orphaned files deleted hourly with grace period."],
              ["Graceful shutdown", "SIGTERM closes server, disconnects DB, exits clean."],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", gap: 12, padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <span style={{color: "#4ade80", minWidth: 180, fontSize: "0.85rem"}}>{name}</span>
                <span style={{color: "#666"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── WHAT THE KERNEL DOES NOT DO ── */}
      <section className="lp-section">
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">What the Kernel Does Not Do</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The kernel does not know about fitness, food, wallets, blogs, scripts, energy budgets,
            understanding runs, dream cycles, or gateway channels. It does not render HTML pages.
            It does not meter usage. It does not tag version numbers. It does not schedule recurring tasks.
            It does not propagate signals between nodes. It does not route cascade between lands.
            It does not filter content. It does not compress context.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 12}}>
            The seed announces that content was written at a cascade-enabled position and records
            what happened. Propagation, routing, filtering, compression are all extensions. The seed
            provides structure, intelligence, extensibility, and communication. Extensions provide meaning.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 16, fontStyle: "italic", color: "rgba(255,255,255,0.4)"}}>
            The land is the ground. Trees grow from it. Each tree pulls data through cascade
            like roots pulling water. The conversation loop is photosynthesis: raw input becomes
            structured output. .flow is the water table, local to the land, felt by every tree.
            Signals cascade up through roots, across lands through Canopy, and down into other
            trees. Sometimes it pools. Sometimes it floods. The seed protects the ground.
            The tree survives. The structure holds.
          </p>
          <div style={{marginTop: 24}}>
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="/about/extensions" style={{marginLeft: 12}}>Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/guide" style={{marginLeft: 12}}>Full Guide</a>
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

export default KernelPage;
