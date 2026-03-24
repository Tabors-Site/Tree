import "./LandingPage.css";

const KernelPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">⚙️</div>
          <h1 className="lp-title">The Kernel</h1>
          <p className="lp-subtitle">What runs when everything else is stripped away.</p>
          <p className="lp-tagline">
            The kernel is the part of TreeOS that cannot change without forking. It defines
            the data contract, the conversation loop, the hook system, and the extension
            loader. Everything else is optional. If you removed every extension, the kernel
            still boots.
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
            goes in the metadata Map. The schemas never change.
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
                12 fields. Type is free-form (6 conventions). Status is active, completed, or trimmed.
                Extensions store their data in metadata under their name.
              </p>
            </div>
            <div className="lp-card">
              <h3>User</h3>
              <div style={{fontFamily: "monospace", fontSize: "0.85rem", color: "#999", lineHeight: 2}}>
                _id, username, password<br/>
                roots[], recentRoots[], remoteRoots[]<br/>
                llmDefault, profileType<br/>
                isRemote, homeLand<br/>
                <span style={{color: "#4ade80"}}>metadata (Map)</span>
              </div>
              <p style={{marginTop: 12, fontSize: "0.85rem", color: "#666"}}>
                10 fields. One default LLM connection. Extensions store energy, billing,
                API keys, LLM slots, and more in metadata.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SYSTEM NODES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">System Nodes</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            When a land boots for the first time, the kernel creates five system nodes.
            They live below the land root and hold all the infrastructure state. They are
            not user content. They are the land's identity, configuration, peer list,
            and extension registry.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>root</div>
              <div className="lp-step-content">
                <h4>Land Root</h4>
                <p>The top-level node. Parent of all trees and system nodes. Has <code>rootOwner: "SYSTEM"</code>.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>.id</div>
              <div className="lp-step-content">
                <h4>.identity</h4>
                <p>Land ID (UUID), domain, Ed25519 public key for Canopy federation signing. Set once at boot. Never changes.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>.cfg</div>
              <div className="lp-step-content">
                <h4>.config</h4>
                <p>
                  All runtime configuration. 17+ kernel tunables stored as metadata keys.
                  Readable and writable via <code>treeos config set</code> or the land-manager AI.
                  Extensions store their own config here too.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>.p</div>
              <div className="lp-step-content">
                <h4>.peers</h4>
                <p>Canopy federation peer list. Children are peer land records with status, uptime history, and last heartbeat.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#666", color: "#fff", fontSize: "0.7rem"}}>.ext</div>
              <div className="lp-step-content">
                <h4>.extensions</h4>
                <p>Extension registry. Each loaded extension is a child node with version, description, and schema version for migrations. Synced on every boot.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── CONFIG KEYS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">17 Kernel Config Keys</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every tunable value in the kernel is configurable from the .config system node.
            No code changes. Set them from the CLI, the API, or through the land-manager AI.
          </p>
          <div style={{maxWidth: 700, margin: "0 auto"}}>
            {[
              ["llmTimeout", "Seconds per LLM API call", "900"],
              ["llmMaxRetries", "Retry count on 429/500", "3"],
              ["maxToolIterations", "Tool calls per message", "15"],
              ["maxConversationMessages", "Context window size", "30"],
              ["defaultModel", "Fallback LLM model", ""],
              ["noteMaxChars", "Max characters per note", "5000"],
              ["treeSummaryMaxDepth", "How deep AI sees the tree", "4"],
              ["treeSummaryMaxNodes", "How many nodes AI sees", "60"],
              ["carryMessages", "Messages carried across mode switch", "4"],
              ["sessionTTL", "Scoped session idle timeout (seconds)", "900"],
              ["staleSessionTimeout", "Stale session cleanup (seconds)", "1800"],
              ["maxSessions", "Max concurrent sessions", "10000"],
              ["aiChatRetentionDays", "Auto-delete AI chats after N days (0=forever)", "90"],
              ["contributionRetentionDays", "Auto-delete contributions after N days (0=forever)", "365"],
              ["canopyEventRetentionDays", "Auto-delete canopy events after N days (0=forever)", "30"],
              ["timezone", "Land timezone for AI prompts", "auto"],
              ["disabledExtensions", "List of disabled extensions", "[]"],
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
          <div className="lp-terminal" style={{maxWidth: 500, margin: "24px auto 0"}}>
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/</span> <span className="lp-term-caret">› </span>config set maxToolIterations 25</div>
              <div className="lp-term-line lp-term-output">  Set maxToolIterations = 25</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── SELF-HEALING ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Self-Healing</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The kernel runs background processes that keep the land healthy without human intervention.
            These are not extensions. They are part of the kernel.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card lp-card-sm">
              <h4>Data Retention</h4>
              <p>Daily cleanup of old AI chat records, contributions, and canopy events. Configurable per collection. Set to 0 to keep forever.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Session Eviction</h4>
              <p>Stale sessions swept every 5 minutes. When the 10K cap is reached, the oldest session is evicted. No memory leak.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Upload Cleanup</h4>
              <p>Orphaned upload files (uploads with no matching note) deleted hourly. Grace period prevents deleting in-progress uploads.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Dead Peer Removal</h4>
              <p>Federation peers marked dead after 30 days unreachable. Auto-removed after 90 days. The heartbeat focuses on live connections.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>LLM Client Cache</h4>
              <p>Resolved LLM connections cached 5 minutes. Periodic sweep removes stale entries. No accumulation over time.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Circuit Breaker</h4>
              <p>Extension hook handlers that fail 5 times in a row are auto-disabled. Success resets the counter. Broken extensions can't degrade the system.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PROTECTION ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Hardened</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The kernel protects itself from extensions, from users, and from time.
          </p>
          <div style={{maxWidth: 600, margin: "0 auto", fontSize: "0.9rem"}}>
            {[
              ["Hook timeout", "5 seconds per handler. Hanging handlers killed."],
              ["Hook cap", "100 handlers per hook. Extension flooding rejected."],
              ["Circuit breaker", "5 consecutive failures auto-disables the handler."],
              ["Metadata size guard", "512KB per extension namespace per node."],
              ["Config clamping", "Kernel values clamped to safe ranges."],
              ["Session cap", "10K max with oldest-first eviction."],
              ["Depth limits", "50 for status cascade, 100 for auth traversal."],
              ["Name validation", "No HTML, no dots, no slashes, max 150 chars."],
              ["Extension name blocklist", "Reserved names rejected at load time."],
              ["Dependent check", "Can't uninstall if others depend on it."],
              ["Spatial scoping", "Extensions blocked per-node. Hooks, tools, modes all filtered."],
              ["Graceful shutdown", "SIGTERM closes server, disconnects DB, exits clean."],
              ["Global error handlers", "Unhandled rejections logged with stack trace."],
              ["LLM failover", "Backup connections tried automatically on failure."],
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

      {/* ── LAND MANAGER ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Land Manager</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The land-manager extension gives the AI system-level access. Navigate to the
            land root (<code>cd /</code>) and chat. The AI reads config, lists users,
            checks peers, manages extensions, and runs diagnostics. With the shell
            extension, it executes server commands. The land manages itself.
          </p>
          <div className="lp-terminal" style={{maxWidth: 550, margin: "0 auto"}}>
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/</span> <span className="lp-term-caret">› </span>chat "show me land status"</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  TreeOS Site on treeos.ai</div>
              <div className="lp-term-line lp-term-output">  25 extensions loaded</div>
              <div className="lp-term-line lp-term-output">  13 users, 26 trees, 2 peers</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/</span> <span className="lp-term-caret">› </span>chat "set AI chat retention to 6 months"</div>
              <div className="lp-term-line lp-term-output">  Set aiChatRetentionDays = 180</div>
            </div>
          </div>
          <p className="lp-section-sub" style={{marginTop: 20}}>
            11 tools: land-status, land-config-read, land-config-set, land-users,
            land-peers, land-system-nodes, land-ext-list, land-ext-install,
            land-ext-disable, land-ext-enable, land-ext-search. Plus execute-shell
            if the shell extension is installed.
          </p>
        </div>
      </section>

      {/* ── THREE LAYERS ── */}
      <section className="lp-section">
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">Three Layers</h2>
          <p className="lp-section-sub">
            <strong style={{color: "#e5e5e5"}}>Kernel</strong> (this page): data contract, hooks, registries, conversation loop. Cannot change without forking.<br/>
            <strong style={{color: "#e5e5e5"}}>Core</strong>: WebSocket server, MCP bridge, OrchestratorRuntime, built-in modes. Ships with every land. Replaceable.<br/>
            <strong style={{color: "#e5e5e5"}}>Extensions</strong>: everything else. Install, remove, build your own.
          </p>
          <div style={{marginTop: 24}}>
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="/ai" style={{marginLeft: 12}}>AI Architecture</a>
            <a className="lp-btn lp-btn-secondary" href="/decentralized" style={{marginLeft: 12}}>The Network</a>
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
