import "./LandingPage.css";

const AIArchitecturePage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero">
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🧠</div>
          <h1 className="lp-title">How AI Works in TreeOS</h1>
          <p className="lp-subtitle">Three zones. Per-node control. Replaceable everything.</p>
          <p className="lp-tagline">
            The AI in TreeOS is not one thing. It is a stack of layers, each customizable
            without touching the one below it. Users control what the AI can do at every node.
            Builders create new AI modes and tools. Developers replace the entire conversation flow.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/">Back to TreeOS</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Full Guide</a>
          </div>
        </div>
      </section>

      {/* ── THREE ZONES ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Three Zones</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Where you are determines what the AI can do. There is no mode menu. No settings panel.
            You navigate, and the AI adapts. <code>cd /</code> and the AI becomes a system operator.
            <code> cd ~/</code> and it becomes your personal assistant. <code>cd MyTree</code> and it
            works the tree with you. The tools, the context, the behavior, all change automatically.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3 style={{color: "#f97316"}}>Land <code>/</code></h3>
              <p>
                The root of everything. Here the AI manages the land itself: install extensions,
                configure settings, monitor users and peers, run diagnostics. With the shell
                extension, it can execute server commands. This is your operations center.
                God-tier access required.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#a78bfa"}}>Home <code>~</code></h3>
              <p>
                Your personal space. The AI helps you organize raw ideas, review notes across
                all your trees, browse your chat history, and reflect on contributions. It knows
                your context across the whole land without being inside any specific tree.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#4ade80"}}>Tree <code>/MyTree</code></h3>
              <p>
                Inside a tree, the AI operates through three strict contracts:
                <strong> Chat</strong> reads and writes (full conversation).
                <strong> Place</strong> adds content silently (no response).
                <strong> Query</strong> reads only (changes nothing).
                The orchestrator classifies your intent and routes accordingly.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── PER-NODE POWER ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Per-Node Customization</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            This is the most powerful feature in the kernel and the one most people will miss.
            Every single node in your tree can have different AI capabilities. Not per-tree.
            Per-node. Different branches, different tools, different thinking, same tree.
          </p>

          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Tools: What AI Can Do</h3>
              <p>
                Each node inherits tools from its parent. Add tools to specific branches.
                Block tools on others. A DevOps branch gets shell access. An archive branch
                loses delete. A training branch gets only read tools.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.85rem", color: "#999", fontFamily: "monospace"}}>
                tools-allow execute-shell<br/>
                tools-block delete-node-branch<br/>
                tools  <span style={{color: "#666"}}># see effective tools</span>
              </div>
            </div>
            <div className="lp-card">
              <h3>Modes: How AI Thinks</h3>
              <p>
                Override which AI mode handles each intent at any node. A research branch
                uses a formal academic mode. A journal branch uses a reflective mode.
                A creative branch uses freeform. Same tree, different personalities.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.85rem", color: "#999", fontFamily: "monospace"}}>
                mode-set respond custom:formal<br/>
                mode-set navigate custom:guided<br/>
                modes  <span style={{color: "#666"}}># see overrides</span>
              </div>
            </div>
            <div className="lp-card">
              <h3>Timeouts: How Long AI Tries</h3>
              <p>
                Different branches can have different patience. A quick-response FAQ branch
                gets 30 seconds. A deep research branch gets 10 minutes. The kernel resolves
                the timeout per node, per mode, or uses the land default.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.85rem", color: "#999", fontFamily: "monospace"}}>
                <span style={{color: "#666"}}># set via metadata</span><br/>
                metadata.timeouts.respond = 30000<br/>
                metadata.timeouts.understand = 600000
              </div>
            </div>
          </div>

          <p className="lp-section-sub" style={{marginTop: 32}}>
            All of this inherits. Set tools on the root and every node in the tree gets them.
            Override on a branch and only that branch changes. The kernel resolves it automatically
            by walking from the current node up to the root, merging at each level.
          </p>
        </div>
      </section>

      {/* ── THE STACK ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The AI Stack</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Four layers. Each one is customizable independently. Most people use the defaults.
            Power users adjust the top layers. Developers replace the bottom ones.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Per-Node Config <span style={{color: "#666", fontWeight: 400}}>(no code)</span></h4>
                <p>
                  Tools, modes, and timeouts set through metadata on any node. CLI commands
                  or API calls. This is what tree owners use. No JavaScript, no extensions,
                  just configuration. The most accessible layer.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a78bfa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Custom Modes <span style={{color: "#666", fontWeight: 400}}>(extension)</span></h4>
                <p>
                  Build a new AI mode with its own system prompt, its own tool set, and its
                  own behavior. Register it during your extension's <code>init()</code>. Now any
                  node on any tree can use it via <code>mode-set</code>. A mode is a personality
                  for the AI at a specific point in its workflow.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f97316", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Custom Tools <span style={{color: "#666", fontWeight: 400}}>(extension)</span></h4>
                <p>
                  Register MCP tools that the AI can call. A web scraper. A code executor.
                  A database query. A physical device controller. Any function your extension
                  provides becomes a capability the AI can use. Tree owners control which
                  nodes have access via per-node tool config.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#fff"}}>4</div>
              <div className="lp-step-content">
                <h4>Custom Orchestrator <span style={{color: "#666", fontWeight: 400}}>(extension)</span></h4>
                <p>
                  Replace the entire conversation flow. The built-in tree-orchestrator does:
                  classify intent, plan, navigate, execute, respond. Your orchestrator can do
                  anything. Multi-agent debate. Parallel research. Code review pipeline. The
                  kernel just dispatches to whatever orchestrator is registered for the zone.
                  One extension. One <code>init()</code> call. The whole AI changes.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── BUILDING AN ORCHESTRATOR ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Building a Custom Orchestrator</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            This is the most ambitious thing you can build on TreeOS. A custom orchestrator
            replaces how the AI thinks about and responds to every message in a zone. The
            built-in tree-orchestrator is 2500 lines of intent classification, navigation,
            planning, and execution. Yours can be 50 lines or 50,000. The kernel does not care.
          </p>
          <div className="lp-terminal" style={{maxWidth: 600, margin: "0 auto"}}>
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">my-orchestrator/index.js</span>
            </div>
            <div className="lp-term-body" style={{fontSize: "0.8rem", lineHeight: 1.7}}>
              <div className="lp-term-line" style={{color: "#666"}}>// Register your orchestrator for the tree zone</div>
              <div className="lp-term-line"><span style={{color: "#a78bfa"}}>export async function</span> init(core) {"{"}</div>
              <div className="lp-term-line">{"  "}core.orchestrators.register(<span style={{color: "#4ade80"}}>"tree"</span>, {"{"}</div>
              <div className="lp-term-line">{"    "}<span style={{color: "#a78bfa"}}>async</span> handle({"{"} message, userId, rootId, ... {"}"}) {"{"}</div>
              <div className="lp-term-line" style={{color: "#666"}}>{"      "}// Your entire AI flow goes here</div>
              <div className="lp-term-line" style={{color: "#666"}}>{"      "}// Use core.llm.processMessage() for LLM calls</div>
              <div className="lp-term-line" style={{color: "#666"}}>{"      "}// Use core.llm.switchMode() to change modes</div>
              <div className="lp-term-line" style={{color: "#666"}}>{"      "}// Use OrchestratorRuntime for chain tracking</div>
              <div className="lp-term-line">{"      "}<span style={{color: "#a78bfa"}}>return</span> {"{"} answer: <span style={{color: "#4ade80"}}>"response"</span> {"};"}</div>
              <div className="lp-term-line">{"    }"}</div>
              <div className="lp-term-line">{"  }"});</div>
              <div className="lp-term-line">{"}"}</div>
            </div>
          </div>
          <p className="lp-section-sub" style={{marginTop: 24}}>
            Install the extension. Restart. Every <code>chat</code>, <code>place</code>, and{" "}
            <code>query</code> in every tree now goes through your orchestrator. The built-in
            one is just the default. Uninstall it and yours takes over. Reinstall it and the
            kernel falls back. Hot-swappable AI brains.
          </p>
        </div>
      </section>

      {/* ── TWO ENTRY POINTS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Two Ways to Talk to AI</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Whether you are building a chat interface or a background pipeline, the kernel
            gives you one function call. No MCP wiring. No session management. No cleanup code.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3 style={{color: "#4ade80"}}>runChat</h3>
              <p>
                Single message, persistent session. For user-facing conversations in any mode.
                Same tree keeps the same conversation. Switch trees, start fresh.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.8rem", color: "#999", fontFamily: "monospace"}}>
                const {"{"} answer {"}"} = await core.llm.runChat({"{"}<br/>
                {"  "}userId, username, message,<br/>
                {"  "}mode: "tree:structure",<br/>
                {"  "}res, <span style={{color: "#555"}}>// auto-abort on disconnect</span><br/>
                {"}"});
              </div>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#a78bfa"}}>OrchestratorRuntime</h3>
              <p>
                Multi-step pipeline with managed lifecycle. For background jobs: dream cycles,
                understanding runs, cleanup passes. Each step switches mode, calls the LLM,
                and tracks the chain.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.8rem", color: "#999", fontFamily: "monospace"}}>
                const rt = new OrchestratorRuntime({"{"} ... {"}"});<br/>
                await rt.init("Starting pipeline");<br/>
                const {"{"} parsed {"}"} = await rt.runStep(mode, {"{"}<br/>
                {"  "}prompt: "Analyze this tree"<br/>
                {"}"});<br/>
                await rt.cleanup();
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── LLM FAILOVER ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Reliability Built In</h2>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <div className="lp-card lp-card-sm">
              <h4>LLM Failover</h4>
              <p>
                Stack backup LLM connections. When your primary hits a rate limit
                or goes down, the kernel tries the next one automatically.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Model Agnostic</h4>
              <p>
                Any OpenAI-compatible endpoint. Ollama, OpenRouter, Together,
                Anthropic, local models. Per-tree and per-mode assignments.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Configurable</h4>
              <p>
                11 kernel tunables from land config. Timeouts, retries, context window,
                tool iterations, session limits. No code changes needed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOOKS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">8 Lifecycle Hooks</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Extensions modify kernel behavior without touching kernel code. Register a handler.
            The kernel fires it at the right moment. Before hooks can cancel operations.
            After hooks react. Enrich hooks inject data into AI context.
          </p>
          <div style={{maxWidth: 600, margin: "0 auto", fontSize: "0.9rem"}}>
            {[
              ["beforeNote", "Modify note data before save"],
              ["afterNote", "React after note create/edit/delete"],
              ["beforeContribution", "Tag audit log entries"],
              ["afterNodeCreate", "Initialize extension data"],
              ["beforeStatusChange", "Validate or intercept"],
              ["afterStatusChange", "React to status changes"],
              ["beforeNodeDelete", "Clean up extension data"],
              ["enrichContext", "Inject data into AI context"],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", justifyContent: "space-between", padding: "8px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <code style={{color: "#4ade80"}}>{name}</code>
                <span style={{color: "#666"}}>{desc}</span>
              </div>
            ))}
          </div>
          <p className="lp-section-sub" style={{marginTop: 24}}>
            Extensions can also fire their own hooks. The hook system is an open bus.
            Any hook name is valid. <code>core.hooks.run("my-ext:afterProcess", data)</code> and
            other extensions can listen.
          </p>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section className="lp-section lp-section-alt" style={{paddingBottom: 60}}>
        <div className="lp-container" style={{textAlign: "center"}}>
          <p style={{
            fontSize: "1.3rem", fontWeight: 700, color: "#e5e5e5", marginBottom: 12,
          }}>
            The kernel handles the plumbing. You build the intelligence.
          </p>
          <p style={{color: "#666", fontSize: "0.95rem", maxWidth: 550, margin: "0 auto"}}>
            MCP connections, session persistence, AIChat tracking, abort handling, chain
            indexing, tool resolution, mode switching, hook firing, LLM failover. All
            automatic. Your extension calls one function and the rest happens.
          </p>
          <div style={{marginTop: 24}}>
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="/guide" style={{marginLeft: 12}}>Read the Guide</a>
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

export default AIArchitecturePage;
