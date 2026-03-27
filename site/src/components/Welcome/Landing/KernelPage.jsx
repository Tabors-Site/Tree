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
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/">Back to TreeOS</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Full Guide</a>
          </div>
        </div>
      </section>

      {/* ── KERNEL COMPARISON ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">This Is the 90s for AI Infrastructure</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A kernel manages hardware so applications don't have to.
            The seed manages intelligence so extensions don't have to.
            Same responsibilities. Different abstraction layer.
          </p>
          <div style={{maxWidth: 800, margin: "0 auto"}}>
            {[
              {
                os: "Process Management",
                osDesc: "Starts and stops programs. Decides which runs, when, for how long. Makes them appear to run at once.",
                seed: "Session Management",
                seedDesc: "AI sessions per user per position. Request queue serializes per session. Orchestrator locks prevent collisions. Session TTL, stale cleanup, 10K cap with oldest-first eviction. maxToolIterations caps runtime. Abort signal cancels mid-message.",
              },
              {
                os: "Memory Management",
                osDesc: "Allocates RAM to programs. Keeps them isolated so one can't crash another. Handles virtual memory and swapping.",
                seed: "Metadata Isolation",
                seedDesc: "Each extension gets its own namespace in the metadata Map. 512KB cap per namespace. 14MB document ceiling with pressure alerts at 80%. Atomic $set prevents concurrent writes from clobbering. Circuit breaker auto-disables crashing extensions. .flow partitions evict oldest data when full.",
              },
              {
                os: "File System",
                osDesc: "Reads and writes files. Organizes folders, permissions, storage structure. Finds files and hands them to apps.",
                seed: "Tree Hierarchy",
                seedDesc: "Nodes are folders. Notes are files. parent points up, children[] points down. Ownership chain controls who writes where. Spatial scoping controls what capabilities exist at each position. Ancestor cache makes lookups fast. Integrity check is fsck. Index verification on boot.",
              },
              {
                os: "Device Drivers",
                osDesc: "Talks to hardware. Apps say 'give me input' without knowing how a keyboard works electrically.",
                seed: "LLM Resolution",
                seedDesc: "LLM endpoints are devices. The resolution chain is driver priority: extension slot on tree, tree default, user slot, user default. Extensions call runChat() without knowing which model, which endpoint, which provider. MCP is the device bus. Tools are system calls. The AI says 'create a node' and MCP routes it.",
              },
              {
                os: "Networking",
                osDesc: "Sends and receives data over networks. Implements TCP/IP and sockets. How apps talk to servers.",
                seed: "WebSockets and Canopy",
                seedDesc: "Socket.IO for real-time client connections. Named event types as the packet format. protocol.js is TCP: shared response shapes before anyone starts talking. Canopy is the network between lands. REST, signed messages, peer discovery. Each land is a host. Canopy is the routing layer.",
              },
              {
                os: "Security and Permissions",
                osDesc: "Controls who can access what. Enforces user permissions and process isolation. Prevents unauthorized access.",
                seed: "Auth, Ownership, Spatial Scoping",
                seedDesc: "JWT + extension auth strategies with fallthrough. Ownership walks the parent chain: first rootOwner is the authority. Contributors accumulate. Spatial scoping blocks entire extensions at a position. Six rules: seed never imports extensions, schemas never change, extension data in metadata only. The kernel can't be injected into.",
              },
              {
                os: "System Call Hooking",
                osDesc: "Intercepts kernel operations. Powerful and dangerous. Used in security tools and rootkits.",
                seed: "Hook System",
                seedDesc: "27 lifecycle hooks. before hooks intercept and cancel. after hooks react in parallel. Any extension can hook any operation. beforeToolCall rewrites arguments. beforeNote blocks writes. Orchestrator replacement swaps the entire conversation flow. 5s timeout, circuit breaker, spatial filtering. Power with guardrails.",
              },
              {
                os: "Inter-Process Communication",
                osDesc: "How programs talk to each other. Shared memory, message passing, signals.",
                seed: "Hooks, Cascade, Canopy",
                seedDesc: "Hooks are pub/sub between extensions. Cascade is message passing between nodes. Canopy is message passing between lands. getExtension() is the direct call interface. Socket handler registry lets extensions push to clients. Every signal produces a visible result in .flow.",
              },
              {
                os: "Boot and Initialization",
                osDesc: "Brings the system up in the right order. Hardware init, driver loading, filesystem mount, service startup.",
                seed: "Boot Sequence",
                seedDesc: "DB connect, index verification, system nodes, config load, seed migrations, integrity check, extension discovery, dependency resolution, topological sort, init(), wire routes/tools/hooks/modes, background jobs, Canopy peering, afterBoot hook. Each step depends on the one before it.",
              },
              {
                os: "Thermal Throttling and Safe Shutdown",
                osDesc: "CPU overheats, kernel throttles the clock. Disk failing, kernel remounts read-only. Data preserved. System protects itself from making things worse.",
                seed: "Tree Circuit Breaker",
                seedDesc: "Health equation monitors node count, metadata density, and error rate. When the score exceeds 1.0, the tree trips. No AI, no writes, no cascade. Read access stays open. Data preserved. Extensions diagnose and revive. The kernel protects the land from one sick tree dragging everything down.",
              },
            ].map(({ os, osDesc, seed, seedDesc }) => (
              <div key={os} style={{
                marginBottom: 32,
                padding: "28px 32px",
                background: "rgba(255,255,255,0.02)",
                border: "1px solid rgba(255,255,255,0.06)",
                borderRadius: 12,
              }}>
                <div style={{
                  display: "flex", justifyContent: "space-between", alignItems: "baseline",
                  marginBottom: 16, flexWrap: "wrap", gap: 8,
                }}>
                  <span style={{fontSize: "0.8rem", color: "rgba(255,255,255,0.35)", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700}}>
                    {os}
                  </span>
                  <span style={{fontSize: "0.8rem", color: "#4ade80", textTransform: "uppercase", letterSpacing: "0.5px", fontWeight: 700}}>
                    {seed}
                  </span>
                </div>
                <div className="lp-kernel-compare">
                  <div>
                    <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.3)", lineHeight: 1.7, margin: 0}}>{osDesc}</p>
                  </div>
                  <div>
                    <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.7, margin: 0}}>{seedDesc}</p>
                  </div>
                </div>
              </div>
            ))}
          </div>
          <p className="lp-section-sub" style={{marginTop: 24, fontStyle: "italic", color: "rgba(255,255,255,0.35)"}}>
            Instead of bridging hardware to software, the seed bridges LLMs to structured data.
            The building blocks for AI operating systems. Extensions add meaning. Lands add presence.
            Canopy adds reach. Everyone can contribute. Everyone can build their own OS on top.
            The plumbing is done.
          </p>
        </div>
      </section>

      {/* ── SCHEMAS ── */}
      <section className="lp-section lp-section-alt">
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
                llmDefault<br/>
                isAdmin, isRemote, homeLand<br/>
                <span style={{color: "#4ade80"}}>metadata (Map)</span>
              </div>
              <p style={{marginTop: 12, fontSize: "0.85rem", color: "#666"}}>
                7 fields. One default LLM connection. Extensions store energy budgets, API keys,
                LLM slot assignments, storage usage, and preferences in metadata.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── THREE ZONES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Three Zones</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Navigation determines the AI's behavior zone. Structural, not interpretive. Determined by URL.
            Zones are kernel. Sub-modes within zones are extensions.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Land <code>/</code></h3>
              <p>System management. Extensions, config, users, peers. Admin access required. The kernel provides a fallback mode. The land-manager extension provides the real one.</p>
            </div>
            <div className="lp-card">
              <h3>Home <code>~</code></h3>
              <p>Personal space. Raw ideas, notes across trees, chat history, contributions. The kernel provides a fallback. Extensions provide the experience.</p>
            </div>
            <div className="lp-card">
              <h3>Tree <code>/MyTree</code></h3>
              <p>Inside a tree. Chat/place/query. The treeos extension registers navigate, structure, edit, respond, librarian. A different extension could register completely different modes.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONVERSATION LOOP ── */}
      <section className="lp-section">
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
              <h3>Before Hooks (9)</h3>
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
                beforeResponse<br/>
                beforeLLMCall<br/>
                beforeToolCall
              </div>
            </div>
            <div className="lp-card">
              <h3>After Hooks (16)</h3>
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
                afterOwnershipChange<br/>
                afterBoot<br/>
                <span style={{color: "#fbbf24"}}>onDocumentPressure</span><br/>
                <span style={{color: "#f87171"}}>onTreeTripped</span><br/>
                <span style={{color: "#4ade80"}}>onTreeRevived</span>
              </div>
            </div>
            <div className="lp-card">
              <h3>Sequential (2)</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Return values captured. Handlers read each other's additions.
              </p>
              <div style={{fontFamily: "monospace", fontSize: "0.8rem", color: "#555", marginTop: 12, lineHeight: 1.8}}>
                enrichContext<br/>
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

      {/* ── FIVE REGISTRIES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Five Registries</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Same pattern across all five. Extensions register. The kernel resolves.
            Failure falls back to the kernel, never to silence.
          </p>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["Hooks", "Lifecycle event handlers. 27 kernel hooks. Extensions fire their own."],
              ["Modes", "AI conversation modes. How the AI thinks at each position."],
              ["Orchestrators", "Conversation flow replacements. Swap the entire chat/place/query pipeline."],
              ["Socket Handlers", "WebSocket event handlers. Extensions add real-time features."],
              ["Auth Strategies", "Authentication methods. JWT is built-in. API keys, share tokens, public access are extensions."],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", gap: 12, padding: "10px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <span style={{color: "#4ade80", minWidth: 140, fontSize: "0.85rem", fontWeight: 600}}>{name}</span>
                <span style={{color: "#888", fontSize: "0.85rem"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── DEEP DIVES ── */}
      <section className="lp-section">
        <div className="lp-container" style={{textAlign: "center"}}>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <a href="/extensions" className="lp-card" style={{textDecoration: "none"}}>
              <h3>Extensions</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                How the tree grows. The manifest, the loader, five registries, spatial scoping.
                How to build one. How an OS emerges from extensions working together.
              </p>
            </a>
            <a href="/network" className="lp-card" style={{textDecoration: "none"}}>
              <h3>The Network</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                How trees connect. Lands, Canopy protocol, Ed25519 signing, federation,
                sovereignty. Your data stays on your land.
              </p>
            </a>
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
                Is this extension active, restricted, blocked, or confined?
                Two modes: global extensions accumulate <code>blocked[]</code> walking up (opt-out).
                Confined extensions check <code>allowed[]</code> walking up (opt-in).
                Confined and not allowed = blocked. Allowed but blocked further down = blocked wins.
                Restricted extensions keep read-only tools.
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

      {/* ── GUARANTEES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Kernel Guarantees</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Promises the seed makes. Not configurable. Not optional. Always true.
          </p>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["Never block inbound", "Cascade signals always accepted. Always produce a result. No configuration can prevent a signal from arriving."],
              ["Position injection", "Every AI prompt receives a [Position] block before the mode's content. The AI always knows where it is. Extension modes cannot exclude it."],
              ["Time injection", "Every AI prompt receives the current time in the land's timezone. Cannot be turned off."],
              ["Extension router timeout", "Extension routes wrapped with 5s timeout. If an extension hangs, the kernel route handles the request. Extensions can never permanently shadow kernel routes."],
              ["Auth fallthrough", "authenticateOptional tries every registered auth strategy. If none match, request continues anonymously. The kernel pipeline handles them all."],
            ].map(([name, desc]) => (
              <div key={name} style={{padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.05)"}}>
                <div style={{color: "#4ade80", fontSize: "0.85rem", fontWeight: 600, marginBottom: 4}}>{name}</div>
                <div style={{color: "#888", fontSize: "0.85rem", lineHeight: 1.7}}>{desc}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── OWNERSHIP ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Ownership</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Ownership resolves by walking the parent chain. The first node with <code>rootOwner</code> set
            is the ownership boundary. Setting rootOwner on a branch delegates that sub-tree to a new owner.
            Contributors accumulate along the walk. If a user is in <code>contributors[]</code> at any node
            between the current position and the ownership boundary, they have write access.
          </p>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["addContributor", "Resolved owner or admin. Atomic $addToSet."],
              ["removeContributor", "Resolved owner, admin, or self-removal."],
              ["setOwner", "Owner above or admin can delegate."],
              ["removeOwner", "Owner above or admin can revoke. Falls back to next owner up."],
              ["transferOwnership", "Current owner or admin can transfer."],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", gap: 12, padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <code style={{color: "#4ade80", fontSize: "0.85rem", minWidth: 180}}>{name}</code>
                <span style={{color: "#888", fontSize: "0.85rem"}}>{desc}</span>
              </div>
            ))}
          </div>
          <p className="lp-section-sub" style={{marginTop: 16, color: "rgba(255,255,255,0.4)"}}>
            All five reject on system nodes. All five validate the chain before writing.
            Extensions use <code>core.ownership.*</code>.
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
            Created at boot by <code>ensureLandRoot()</code>. They hold infrastructure state, not user content.
            Every boot verifies all six exist. Missing nodes are recreated. System nodes with wrong parents are repaired automatically.
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
                <p>Cascade result store. Daily partition children hold results by date. Retention deletes entire partitions. flowMaxResultsPerDay caps growth per day. The land's short-term memory of what moved and what happened.</p>
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
              ["cascadeMaxDeliveriesPerSignal", "Max child deliveries per signal", "500"],
              ["chatRateLimit", "Max chat messages per rate window per user", "10"],
              ["chatRateWindowMs", "Chat rate limit window (ms)", "60000"],
              ["uploadEnabled", "Master switch for uploads", "true"],
              ["maxUploadBytes", "Hard ceiling per upload", "104857600"],
              ["allowedMimeTypes", "MIME prefix filter (null = all)", "null"],
              ["maxDocumentSizeBytes", "Document size ceiling (2MB headroom under MongoDB 16MB)", "14680064"],
              ["flowMaxResultsPerDay", "Max cascade results per daily partition", "10000"],
              ["allowedFrameDomains", "CSP frame-ancestors domains", "[]"],
              ["ancestorCacheTTL", "Parent chain cache TTL (ms)", "30000"],
              ["integrityCheckInterval", "Tree fsck interval (ms, 24h default)", "86400000"],
              ["treeCircuitEnabled", "Master switch for tree circuit breaker", "false"],
              ["maxTreeNodes", "Node count threshold for health equation", "10000"],
              ["maxTreeMetadataBytes", "Metadata size threshold", "1073741824"],
              ["maxTreeErrorRate", "Errors per hour threshold", "100"],
              ["circuitNodeWeight", "Node count weight in equation", "0.4"],
              ["circuitDensityWeight", "Metadata density weight", "0.3"],
              ["circuitErrorWeight", "Error rate weight", "0.3"],
              ["circuitCheckInterval", "Health check interval (ms, 1h)", "3600000"],
              ["toolCircuitThreshold", "Consecutive tool failures before session disable", "5"],
              ["llmMaxConcurrent", "Max in-flight LLM calls across all users", "20"],
              ["failoverTimeout", "Seconds to walk LLM failover stack before giving up", "15"],
              ["toolCallTimeout", "Seconds before a tool call is killed", "60"],
              ["toolResultMaxBytes", "Max tool result size before truncation (bytes)", "50000"],
              ["maxNotesPerNode", "Max notes per node", "1000"],
              ["maxConversationSessions", "Hard cap on in-memory conversation sessions", "50000"],
              ["staleConversationTimeout", "Seconds before idle conversation is swept", "1800"],
              ["maxRegisteredTools", "Max tools in the registry", "500"],
              ["maxRegisteredModes", "Max modes in the registry", "200"],
              ["landLlmConnection", "Land-wide fallback LLM connection ID for users without their own", "null"],
              ["maxConnectionsPerUser", "Max custom LLM connections per user (1-100)", "15"],
              ["maxOrchestrators", "Max registered orchestrators", "10"],
              ["jwtExpiryDays", "JWT token lifetime in days (1-365)", "30"],
              ["npmInstallTimeout", "Timeout for npm install in extension directories (ms)", "60000"],
              ["seedVersion", "Current seed version (set by migration runner)", "0.1.0"],
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
              ["Hook circuit breaker", "5 failures auto-disables. Half-open recovery after 5 minutes: one test call, success resets, failure re-opens."],
              ["enrichContext chain timeout", "15s cumulative cap for the entire sequential handler chain. Per-handler timeout reduced to remaining budget."],
              ["Tool circuit breaker", "5 failures disables one tool per session. AI adapts to other tools."],
              ["Tree circuit breaker", "Health equation monitors nodes, metadata, errors. Score > 1.0 trips to read-only. Extensions revive. Defaults off."],
              ["LLM concurrency semaphore", "llmMaxConcurrent (20) caps in-flight LLM calls. Excess queued. Jittered backoff on 429."],
              ["Extension init timeout", "10s per extension init(). Hanging init skipped, boot continues."],
              ["Extension router timeout", "5s on page routes (/). API routes not wrapped. Mid-stream responses closed after timeout."],
              ["Extension install rollback", "Files written to staging dir. Atomic rename on success. Cleanup on failure. No partial installs."],
              ["MCP spatial scoping", "Tool calls check isExtensionBlockedAtNode before dispatch. Same scoping as WebSocket."],
              ["MCP client cap", "5,000 max clients. Oldest evicted. 10s connect timeout. 5s close timeout. Stale sweep every 15m. Token isolation."],
              ["WebSocket safety", "Payload sanitization (200 char strings, 500 char JSON). ID validation (36 char cap). Auth failure logging. Broadcast event name validation."],
              ["Metadata guard", "Blocked extensions can't write. Four core namespaces bypass. Key length max 50 chars. Nesting depth max 5 levels."],
              ["Document size guard", "14MB ceiling. 512KB per namespace. onDocumentPressure at 80%."],
              ["Note count per node", "maxNotesPerNode (1000). Prevents runaway loops."],
              ["Contribution extensionData cap", "512KB per contribution. Prevents buggy extensions writing unbounded data."],
              [".flow partitioning", "Daily partitions. Circular overwrite. Retention by date."],
              ["Ownership chain", "rootOwner/contributor mutations validate parent chain. System nodes rejected."],
              ["Ancestor cache", "One walk serves six resolution chains. Snapshot per message. Auto-invalidation on changes."],
              ["Atomic metadata writes", "MongoDB $set per namespace. Concurrent writes never clobber."],
              ["DB health check", "Before each tool call. Dead DB tells AI to inform user. 30s socket timeout. 5s heartbeat. Event monitoring. Graceful shutdown."],
              ["SSRF protection", "Peer registration validates hostname. 15s timeout on all federation fetches."],
              ["Federation system tokens", "System-to-system canopy tokens. Auth returns system identity. Route handlers gate access."],
              ["Password safety", "Min 8, max 128 chars. 5s bcrypt verify timeout. Prevents DoS from extreme cost factors."],
              ["JWT security", "Unique jti per token for revocation tracking. Configurable expiry (1-365 days). Token revocation via metadata.auth.tokensInvalidBefore."],
              ["Username validation", "Regex ^[a-zA-Z0-9_-]{1,32}$. Trimmed. Rejects HTML, special chars, whitespace-only."],
              ["Auth input guards", "All auth functions validate input types. Null/undefined returns clear error, not crash."],
              ["bcrypt hardening", "Cost factor 12 (NIST 2025+). Hash prefix bypass closed. Timing-safe login with dummy hash for non-existent users."],
              ["Auth strategy sanitization", "Extension strategies cannot overwrite userId/username/authType via result.extra. Core fields stripped."],
              ["Cookie-JWT sync", "Cookie maxAge reads jwtExpiryDays from config. Always expire together."],
              ["Auth logging", "authenticateOptional logs all failures at debug level. Zero silent catch blocks."],
              ["Config safety", "Deep copy on reads. Prototype pollution keys stripped. Write verification against DB. Delete via atomic $unset. Reload without restart. Change audit logging."],
              ["Boot recovery", "All six system nodes verified every boot. Missing recreated. Wrong parents repaired. Partial first-boot crashes recoverable."],
              ["Extension sync atomicity", "syncExtensionsToTree uses atomic $addToSet. One save failure doesn't corrupt the tree."],
              ["Orchestrator safety", "30s init timeout. Init rollback on failure. 500 max steps. Zombie guard (no ops after cleanup). Lock ownership with renewal. Abort on cleanup kills in-flight LLM calls. Idempotent cleanup. MCP retry with backoff. 4h internal JWT. Duration tracking."],
              ["Lock safety", "Owner tracking (userId + visitorId). Release rejects wrong owner. Renewal without release. 10K hard cap. Input validation. Force release for admin. Visibility via getLockInfo/listLocks. Sweep logging."],
              ["Scope ownership safety", "Tool/mode ownership validated (1-64 chars). Capped at config limits. Cleanup on extension uninstall. Static hook import for notifyScopeChange."],
              ["Node locks", "Structural mutations (create, move, delete, ownership) acquire short-lived in-memory locks. Sorted acquisition prevents deadlocks. TTL expiry (30s) prevents permanent locks on crash."],
              ["LLM priority queue", "Human > Gateway > Interactive > Background. Background jobs (dreams, understanding, compression) yield to users typing. Twenty concurrent slots default."],
              ["Namespace enforcement", "setExtMeta enforces namespace ownership through scoped core. Extensions can only write to their own namespace. Core namespaces rejected for all callers."],
              ["npm install safety", "Extension npm deps run with --ignore-scripts. No preinstall/postinstall code execution. 60s timeout. Rollback on failure."],
              ["Confined extensions", "scope: confined in manifest. Active nowhere by default. Requires explicit allowed[] at a node to activate. Shell, solana, scripts default to confined."],
              ["Seed versioning", "Migrations in order. Failed retry next boot."],
              ["Tree integrity check", "Boot and daily. Auto-repair phantom refs. Orphans logged."],
              ["Index verification", "Boot. Create missing. No collection scans."],
              ["Session cap", "10K max (configurable) with oldest-first eviction. Scoped session cap 20K. Session meta capped at 64KB."],
              ["Core session types immutable", "Extensions register custom types but can't overwrite core types. Stale sweep and navigator promotion stay intact."],
              ["Session setter bounds", "maxSessions: 100-500K. sessionTTL: 5s-24h. staleTimeout: 1m-24h. No setter can brick the registry."],
              ["Session cleanup", "Stale sweep cleans orphaned abort controllers. clearUserSessions fires afterSessionEnd per session, not silent bulk delete."],
              ["Depth limits", "50 status cascade, 100 auth traversal, 50 cascade propagation."],
              ["Name validation", "No HTML, no dots, no slashes, max 150 chars."],
              ["Never block inbound", "Cascade signals always accepted. Always write a result."],
              ["Cascade depth limit", "cascadeMaxDepth (50). Exceeding rejected."],
              ["Upload guard", "Master switch, 100MB ceiling, MIME filter. Pre-multer."],
              ["Upload cleanup", "Orphaned files deleted hourly with grace period."],
              ["Graceful shutdown", "All timers .unref(). SIGTERM closes clean."],
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
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Full Guide</a>
          </div>
        </div>
      </section>

      {/* ── LICENSE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 700}}>
          <h2 className="lp-section-title">License</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The seed is <strong style={{color: "#e5e5e5"}}>AGPL-3.0</strong>. You can run it, modify it, build on it.
            If you modify the seed and run it as a service, you share your seed modifications.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "rgba(255,255,255,0.4)"}}>
            Extensions are separate works. They interact with the seed through the defined API
            (core services bundle, hooks, registries, metadata Maps). Extension authors choose their
            own license. The seed license does not infect extensions. Build proprietary extensions,
            open source extensions, whatever you want. The ecosystem is free.
          </p>
          <p className="lp-section-sub" style={{color: "rgba(255,255,255,0.3)", fontSize: "0.85rem"}}>
            Every file in <code>seed/</code> carries a one-line header: <code>// TreeOS Seed . AGPL-3.0 . https://treeos.ai</code>.
            Extension manifests declare a <code>license</code> field. The Horizon and CLI display it.
            Nothing blocks extensions without licenses. The seed is open. The ecosystem is free.
            Legal terms protect the seed. Code enforcement doesn't.
          </p>
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
              <a href="/land">Start a Land</a>
              <a href="/cli">CLI</a>
            </div>
            <div className="lp-footer-col">
              <h4>TreeOS</h4>
              <a href="/app">Site</a>
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
              <a href="https://github.com/Tabors-Site/Tree">GitHub</a>
              <a href="https://github.com/Tabors-Site/Tree/blob/main/LICENSE">AGPL-3.0 License</a>
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

export default KernelPage;
