import "./LandingPage.css";
import Particles from "./Particles.jsx";

const AIArchitecturePage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🧠</div>
          <h1 className="lp-title">The AI</h1>
          <p className="lp-subtitle">How the tree thinks.</p>
          <p className="lp-tagline">
            An intent routing system whose most natural developer interface is a linguistic grammar
            that unifies and clarifies the underlying architecture.
          </p>
          <p className="lp-tagline" style={{fontSize: "0.9rem", color: "rgba(255,255,255,0.35)", maxWidth: 480}}>
            A conversation loop in the seed that resolves which LLM to call,
            which tools to provide, which mode to think in, and which position context to inject.
            All based on where you are in the tree.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/flow">The Flow</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
          </div>
        </div>
      </section>

      {/* ── THE INVERSION ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 700}}>
          <div style={{
            padding: "24px 28px", borderLeft: "3px solid rgba(167, 139, 250, 0.4)",
            background: "rgba(167, 139, 250, 0.03)", borderRadius: "0 12px 12px 0",
            marginBottom: 8,
          }}>
            <p style={{color: "#e5e5e5", fontSize: "1.05rem", lineHeight: 1.7, fontStyle: "italic"}}>
              Human thought is structured like a tree. Language reflects that structure.
              So if you build a system as a tree, you can use language directly as the interface.
            </p>
          </div>
          <p style={{color: "#999", fontSize: "0.9rem", lineHeight: 1.7, textAlign: "center", padding: "0 20px"}}>
            Most AI systems ask "how do I get the AI to do the right thing?" TreeOS asks "how do
            I build an environment where the right thing is the only thing the AI can say?" The
            tools, the context, and the constraints change based on where you are. The structure
            constrains the output before the AI speaks. Position gives the AI genuine situational
            awareness, not through one giant prompt, but through architecture that mirrors how
            concepts actually relate to each other.
          </p>
        </div>
      </section>

      {/* ── THREE ZONES ── */}
      <section className="lp-section lp-section-alt">
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
                Admin access required.
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
              <h3>Extensions: What Capabilities Exist</h3>
              <p>
                Block entire extensions at any node. A knowledge tree blocks Solana, scripts,
                and shell. A shared tree blocks dangerous extensions at the root so contributors
                can't use them. Blocked extensions lose their hooks, tools, modes, and metadata
                writes at that node and all children. Navigate somewhere and the world reshapes.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.85rem", color: "#999", fontFamily: "monospace"}}>
                ext-block solana scripts shell<br/>
                ext-scope  <span style={{color: "#666"}}># see what's active here</span><br/>
                ext-scope -t  <span style={{color: "#666"}}># tree-wide block map</span>
              </div>
            </div>
          </div>

          <p className="lp-section-sub" style={{marginTop: 32}}>
            All three layers inherit parent to child. Set a block on the root and every node
            in the tree inherits it. Override on a branch and only that branch changes.
            The kernel walks from the current node up to the root, merging at each level.
            One tree can have a branch with shell access, another that's read-only, and
            another that can't even see certain extensions exist. No code changes. Just metadata.
          </p>
        </div>
      </section>

      {/* ── THE STACK ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The AI Stack</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Five layers. Each one is customizable independently. Most people use the defaults.
            Power users adjust the top layers. Developers replace the bottom ones.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Per-Node Config <span style={{color: "#666", fontWeight: 400}}>(no code)</span></h4>
                <p>
                  Tools, modes, extensions, and timeouts set through metadata on any node.
                  CLI commands or API calls. Block an extension at the root and it disappears
                  from the entire tree. Tools, modes, hooks, metadata writes, all filtered
                  by position. The most accessible layer.
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
            This is the most ambitious thing you can build on the seed. A custom orchestrator
            replaces how the AI thinks about and responds to every message in a zone. The
            built-in tree-orchestrator is itself an extension, 2500 lines of intent classification, navigation,
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
          <h2 className="lp-section-title">Two Primitives</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Whether you are building a chat interface or a background job, the kernel gives
            you one function call. No MCP wiring. No session management. No hook firing.
            No cleanup code. Pick the primitive that matches your need.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3 style={{color: "#4ade80"}}>runChat</h3>
              <p>
                One LLM call, one explicit mode. For background work in extensions:
                summarize, classify, enrich. The caller knows exactly which mode to use
                and just wants an answer.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.8rem", color: "#999", fontFamily: "monospace"}}>
                const {"{"} answer {"}"} = await core.llm.runChat({"{"}<br/>
                {"  "}userId, username, message,<br/>
                {"  "}mode: "tree:structure",<br/>
                {"  "}llmPriority: BACKGROUND,<br/>
                {"}"});
              </div>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#a78bfa"}}>runOrchestration</h3>
              <p>
                Full chat flow. Classification, routing, mode chains, tool loops. For
                anything where a real user is waiting. Used by every HTTP route, the
                websocket handler, and gateway extensions. One function. Every entry point.
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.8rem", color: "#999", fontFamily: "monospace"}}>
                const result = await core.llm.runOrchestration({"{"}<br/>
                {"  "}zone: "tree", userId, message,<br/>
                {"  "}rootId, currentNodeId,<br/>
                {"  "}res, <span style={{color: "#555"}}>// auto-abort on disconnect</span><br/>
                {"}"});
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── THE PIPELINE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">One Function in the Middle</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every chat path on the system converges on the same kernel function. CLI,
            dashboard, gateway extensions, scheduled jobs. Different transports, different
            wire formats, same pipeline. Three layers, blind to each other.
          </p>

          <div style={{
            maxWidth: 760, margin: "32px auto", display: "flex", flexDirection: "column", gap: 0,
          }}>
            {/* Entry points */}
            <div style={{
              display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, marginBottom: 4,
            }}>
              <div style={{
                background: "rgba(74, 222, 128, 0.08)",
                border: "1px solid rgba(74, 222, 128, 0.3)",
                borderRadius: 8, padding: "14px 16px", textAlign: "center",
              }}>
                <div style={{color: "#4ade80", fontWeight: 600, fontSize: "0.9rem"}}>CLI</div>
                <div style={{color: "#888", fontSize: "0.7rem", marginTop: 4}}>HTTP</div>
              </div>
              <div style={{
                background: "rgba(74, 222, 128, 0.08)",
                border: "1px solid rgba(74, 222, 128, 0.3)",
                borderRadius: 8, padding: "14px 16px", textAlign: "center",
              }}>
                <div style={{color: "#4ade80", fontWeight: 600, fontSize: "0.9rem"}}>Dashboard</div>
                <div style={{color: "#888", fontSize: "0.7rem", marginTop: 4}}>WebSocket</div>
              </div>
              <div style={{
                background: "rgba(74, 222, 128, 0.08)",
                border: "1px solid rgba(74, 222, 128, 0.3)",
                borderRadius: 8, padding: "14px 16px", textAlign: "center",
              }}>
                <div style={{color: "#4ade80", fontWeight: 600, fontSize: "0.9rem"}}>Gateway</div>
                <div style={{color: "#888", fontSize: "0.7rem", marginTop: 4}}>Telegram, Email, etc.</div>
              </div>
            </div>

            {/* Arrow */}
            <div style={{textAlign: "center", color: "#444", fontSize: "1.2rem", lineHeight: 1}}>↓</div>

            {/* Transport adapters */}
            <div style={{
              background: "rgba(255, 255, 255, 0.03)",
              border: "1px solid rgba(255, 255, 255, 0.08)",
              borderRadius: 8, padding: "14px 18px", textAlign: "center",
            }}>
              <div style={{color: "#999", fontWeight: 600, fontSize: "0.9rem"}}>
                Thin transport adapters
              </div>
              <div style={{color: "#666", fontSize: "0.75rem", marginTop: 4}}>
                validate, auth, translate to and from the wire
              </div>
            </div>

            <div style={{textAlign: "center", color: "#444", fontSize: "1.2rem", lineHeight: 1}}>↓</div>

            {/* The kernel primitive */}
            <div style={{
              background: "rgba(167, 139, 250, 0.1)",
              border: "2px solid rgba(167, 139, 250, 0.5)",
              borderRadius: 10, padding: "20px 24px", textAlign: "center",
              boxShadow: "0 0 30px rgba(167, 139, 250, 0.15)",
            }}>
              <div style={{color: "#a78bfa", fontWeight: 700, fontSize: "1.1rem", letterSpacing: "0.02em"}}>
                runOrchestration
              </div>
              <div style={{color: "#888", fontSize: "0.7rem", marginTop: 4, fontFamily: "monospace"}}>
                seed/llm/conversation.js
              </div>
              <div style={{
                color: "#aaa", fontSize: "0.78rem", marginTop: 12, lineHeight: 1.7,
                display: "grid", gridTemplateColumns: "1fr 1fr", gap: "2px 16px",
                textAlign: "left", maxWidth: 480, margin: "12px auto 0",
              }}>
                <div>· session identity</div>
                <div>· abort handling</div>
                <div>· MCP connect</div>
                <div>· dispatch</div>
                <div>· Chat record</div>
                <div>· beforeResponse hook</div>
                <div>· enqueue serialize</div>
                <div>· cleanup</div>
              </div>
            </div>

            <div style={{textAlign: "center", color: "#444", fontSize: "1.2rem", lineHeight: 1}}>↓</div>

            {/* The orchestrator extension */}
            <div style={{
              background: "rgba(249, 115, 22, 0.08)",
              border: "1px solid rgba(249, 115, 22, 0.3)",
              borderRadius: 8, padding: "14px 18px", textAlign: "center",
            }}>
              <div style={{color: "#f97316", fontWeight: 600, fontSize: "0.9rem"}}>
                Orchestrator extension for the zone
              </div>
              <div style={{color: "#888", fontSize: "0.75rem", marginTop: 4}}>
                tree-orchestrator (built in), or your own. Replaceable.
              </div>
            </div>
          </div>

          <p className="lp-section-sub" style={{marginTop: 32, maxWidth: 720}}>
            The kernel owns the pipeline. Extensions own the routing. Transport adapters own
            the wire format. Each layer is blind to the others. The kernel does not know
            fitness exists. The extension does not know HTTP exists. The transport does not
            know modes exist. <code>beforeResponse</code> fires in exactly one place per
            primitive, never in routes, never in handlers. The middle never changes.
          </p>
        </div>
      </section>

      {/* ── LLM FAILOVER ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Reliability Built In</h2>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr 1fr"}}>
            <div className="lp-card lp-card-sm">
              <h4>Position and Time Injection</h4>
              <p>Every prompt starts with a [Position] block and ends with the current time in the land's timezone. The AI always knows where it is and when it is. Extension modes cannot exclude either.</p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 6, padding: "8px 12px", marginTop: 8, fontFamily: "monospace", fontSize: "0.75rem", color: "#888", lineHeight: 1.6}}>
                [Position]<br/>
                User: tabor<br/>
                Tree: My Fitness (abc-123)<br/>
                Current node: Push Day (xyz-456)<br/>
                <br/>
                {"<mode system prompt>"}<br/>
                <br/>
                Current time: Thursday, April 9,<br/>
                2026, 7:23 PM PDT
              </div>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>LLM Failover</h4>
              <p>Backup LLM connections. Rate limit or outage hits, the kernel tries the next one automatically.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Model Agnostic</h4>
              <p>Any OpenAI-compatible endpoint. Per-tree and per-mode LLM assignments.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Tool Circuit Breaker</h4>
              <p>5 failures disables one tool for the session. The AI adapts. One bad API key doesn't kill the tree.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>DB Health Check</h4>
              <p>Before each tool call, check database. If dead, the AI tells the user instead of retrying blind.</p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Ancestor Cache</h4>
              <p>One shared cache for all resolution chains. Snapshot per message. 120 DB queries become 1.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOOKS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">27 Lifecycle Hooks</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Extensions modify kernel behavior without touching kernel code. Register a handler.
            The kernel fires it at the right moment. Before hooks can cancel. After hooks react.
            Sequential hooks capture return values. Open bus: any hook name is valid.
          </p>
          <div style={{maxWidth: 600, margin: "0 auto", fontSize: "0.9rem"}}>
            {[
              ["beforeNote", "Modify note data before save"],
              ["afterNote", "React after note create/edit/delete"],
              ["beforeNodeCreate", "Modify or cancel node creation"],
              ["afterNodeCreate", "Initialize extension data"],
              ["beforeStatusChange", "Validate or intercept"],
              ["afterStatusChange", "React to status changes"],
              ["beforeNodeDelete", "Clean up extension data"],
              ["beforeContribution", "Modify contribution data"],
              ["enrichContext", "Inject data into AI context"],
              ["beforeLLMCall", "Cancel or modify LLM calls"],
              ["afterLLMCall", "React to LLM usage"],
              ["beforeToolCall", "Modify or cancel tool execution"],
              ["afterToolCall", "React to tool results"],
              ["beforeResponse", "Modify AI response before client"],
              ["beforeRegister", "Validate registration (email, etc.)"],
              ["afterRegister", "Initialize user data"],
              ["afterNavigate", "React to tree navigation"],
              ["afterMetadataWrite", "React to metadata changes"],
              ["afterScopeChange", "React to extension scope changes"],
              ["afterOwnershipChange", "React to ownership or contributor changes"],
              ["afterBoot", "One-time setup after everything is ready"],
              ["afterSessionCreate", "React to new sessions"],
              ["afterSessionEnd", "React to ended sessions"],
              ["onCascade", "Handle cascade signals, results to .flow"],
              ["onDocumentPressure", "Document approaching size limit"],
              ["onTreeTripped", "Tree circuit breaker tripped"],
              ["onTreeRevived", "Tripped tree revived"],
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

      {/* ── THE GRAMMAR ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The Grammar</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The tree doesn't translate natural language into code. It translates natural
            language into more natural language at a lower level. The user says a sentence.
            The tree diagrams it. Each part of the diagram maps to an architectural primitive.
            The execution IS the parse tree.
          </p>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3 style={{color: "#a78bfa"}}>Nouns = Nodes</h3>
              <p>
                Bench Press. Protein. Chapter 3. Things with identity, position, and
                relationships. They sit in the tree and hold meaning. The routing index
                is the vocabulary list: which nouns belong to which verb.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#4ade80"}}>Verbs = Extensions</h3>
              <p>
                Food tracks. Fitness logs. Recovery reflects. Study teaches. Ways of being
                at a position. Install an extension and the tree gains a new capability,
                a new way to act on its nouns.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#ecc94b"}}>Tense = Modes</h3>
              <p>
                Once the territory is identified, the intent determines the tense. Four
                conjugations for every verb:
              </p>
              <div style={{background: "rgba(0,0,0,0.3)", borderRadius: 8, padding: "12px 16px", marginTop: 12, fontSize: "0.85rem", color: "#999", lineHeight: 1.8}}>
                <strong style={{color: "#a78bfa"}}>Review</strong> (past): "how did I do" "my progress"<br/>
                <strong style={{color: "#4ade80"}}>Coach</strong> (future): "what should I" "help me"<br/>
                <strong style={{color: "#f97316"}}>Plan</strong> (imperative): "build" "create" "add"<br/>
                <strong style={{color: "#ecc94b"}}>Log</strong> (present): "ate eggs" "bench 135x10"
              </div>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#f97316"}}>Routing = Parsing</h3>
              <p>
                "Ate eggs" contains food nouns. "Bench 135" contains fitness nouns.
                The classifier hints are vocabulary lists. The routing index maps
                territory. This noun-space belongs to this verb.
              </p>
            </div>
          </div>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr", marginTop: 12}}>
            <div className="lp-card">
              <h3 style={{color: "#f97316"}}>Adjectives = Metadata</h3>
              <p>
                135lb. 5x5. Ready for progression. Values, goals, and status describe
                each noun. The <code>enrichContext</code> hook injects adjectives into
                the AI's view of a position.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#7dd385"}}>Adverbs = Instructions</h3>
              <p>
                "Be concise." "Use kg." "Never suggest meat." They modify how the verb
                behaves without changing the verb. Food still logs. It just logs concisely.
                The <code>beforeLLMCall</code> prepend is the adverbial layer.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#c4c8d0"}}>Prepositions = Tree Structure</h3>
              <p>
                Under Health. Next to Food. Above Bench Press. Spatial scoping IS
                prepositional. <code>ext-block shell UNDER DevOps</code>.{" "}
                <code>ext-allow solana AT Finance</code>. The spatial commands
                are literally prepositions applied to the tree.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#60a5fa"}}>Pronouns = Position</h3>
              <p>
                "It" = currentNodeId. "Here" = where you are. "This tree" = rootId.
                The position system resolves pronouns. When you say "log this" the
                system knows what "this" means because of where you're standing.
              </p>
            </div>
          </div>

          <div style={{maxWidth: 700, margin: "24px auto 0"}}>
            <div className="lp-card" style={{textAlign: "center"}}>
              <h3 style={{color: "#f472b6"}}>Articles = Existence</h3>
              <p>
                "THE bench press" means the routing index found it. It exists. Route to it.
                "A bench press" means it doesn't exist yet. Sprout activates. Creates it.
                Definite versus indefinite. Existing versus potential.
              </p>
            </div>
          </div>

          {/* ── COMPLETING THE GRAMMAR ── */}
          <div style={{maxWidth: 780, margin: "64px auto 16px", textAlign: "center"}}>
            <h2 style={{color: "#e5e5e5", fontSize: "1.4rem", marginBottom: 8}}>Completing the Grammar</h2>
            <p style={{color: "#888", fontSize: "0.9rem", lineHeight: 1.7, maxWidth: 620, margin: "0 auto"}}>
              Eight parts of speech was the first pass. Standard English has nine, and every sentence the
              original system couldn't handle was missing one of them. We did not invent new primitives.
              We finished the set.
            </p>
          </div>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr", marginTop: 12}}>
            <div className="lp-card">
              <h3 style={{color: "#38bdf8"}}>Conjunctions = Control Flow</h3>
              <p>
                The missing ninth part of speech. Subordinating conjunctions ("if", "when", "unless")
                become branches. Coordinating conjunctions ("and then", "after that") become chains.
                The original system only did linear routing. Now it handles
                <strong style={{color: "#cbd5e1"}}> "if protein is low, review my meals"</strong> as a
                real branch with a condition evaluated against live data, not as a phrase the AI has
                to interpret.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#fb923c"}}>Determiners = Set Selection</h3>
              <p>
                Articles ("the", "a") were part of the original eight. But "all", "every", "top 3"
                are also determiners, and they select sets, not single items. The original system
                lumped them into metadata. Now they drive fanout: the kernel resolves the set,
                gathers each item's real data, and hands everything to the mode at once. No guessing.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#fde047"}}>Adverbials of Time = Data Window</h3>
              <p>
                "Last week", "yesterday", "since January", "over the past month". These are not
                tense. Tense is intent (review vs log vs coach). Time is data scope (which window
                to look at). The original system conflated them and misrouted messages. Now they
                are independent axes. "How did I do last week" has tense=review AND scope=last week.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#c084fc"}}>Voice + Negation = Frame</h3>
              <p>
                Passive voice ("my bench press has been declining") tells the AI to reflect, not
                execute. Negation ("don't log that", "skip breakfast") cancels the default action
                and reroutes to conversation. The original system treated everything as active
                imperatives. Now it distinguishes describing from commanding, and cancelling from
                doing.
              </p>
            </div>
          </div>

          {/* ── FIVE ORTHOGONAL AXES ── */}
          <div style={{maxWidth: 780, margin: "48px auto 16px", textAlign: "center"}}>
            <h2 style={{color: "#e5e5e5", fontSize: "1.4rem", marginBottom: 8}}>Five Orthogonal Axes</h2>
            <p style={{color: "#888", fontSize: "0.9rem", lineHeight: 1.7, maxWidth: 620, margin: "0 auto"}}>
              Every message decomposes into five independent axes. Each one evolves on its own.
              Any combination is legal. The grammar is compositional, not enumerative.
            </p>
          </div>

          <div style={{maxWidth: 780, margin: "16px auto 0", display: "grid", gridTemplateColumns: "1fr", gap: 8}}>
            {[
              { label: "DOMAIN", color: "#a78bfa", question: "what thing?", parts: "noun + pronoun + preposition", determines: "Which extension, which node, which scope." },
              { label: "SCOPE", color: "#fb923c", question: "how much, when?", parts: "quantifier + temporal scope", determines: "Which subset of data is in play." },
              { label: "INTENT", color: "#ecc94b", question: "what action?", parts: "tense + conditional", determines: "Which mode fires, or whether to branch." },
              { label: "INTERPRETATION", color: "#c084fc", question: "how to behave?", parts: "adjective + voice + adverb", determines: "How the mode frames its response." },
              { label: "EXECUTION", color: "#f97316", question: "runtime shape?", parts: "dispatch / sequence / fork / fanout", determines: "How the graph actually runs." },
            ].map(a => (
              <div key={a.label} style={{
                display: "grid", gridTemplateColumns: "160px 1fr", gap: 16, alignItems: "center",
                padding: "14px 18px", background: "rgba(255,255,255,0.02)",
                border: `1px solid ${a.color}22`, borderRadius: 8,
              }}>
                <div>
                  <div style={{color: a.color, fontWeight: 700, fontSize: "0.75rem", letterSpacing: 1}}>{a.label}</div>
                  <div style={{color: "#666", fontSize: "0.7rem", fontStyle: "italic"}}>{a.question}</div>
                </div>
                <div>
                  <div style={{color: "#ccc", fontSize: "0.82rem", marginBottom: 2}}>{a.parts}</div>
                  <div style={{color: "#888", fontSize: "0.78rem", lineHeight: 1.5}}>{a.determines}</div>
                </div>
              </div>
            ))}
          </div>

          {/* ── EXECUTION GRAPH PRIMITIVES ── */}
          <div style={{maxWidth: 780, margin: "48px auto 16px", textAlign: "center"}}>
            <h2 style={{color: "#e5e5e5", fontSize: "1.4rem", marginBottom: 8}}>Four Execution Primitives</h2>
            <p style={{color: "#888", fontSize: "0.9rem", lineHeight: 1.7, maxWidth: 620, margin: "0 auto"}}>
              After parsing, the grammar compiles every message into an execution graph with four
              possible shapes. These are not invented primitives. They are the four ways English
              composes sentences.
            </p>
          </div>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr", marginTop: 12}}>
            <div className="lp-card">
              <h3 style={{color: "#f97316"}}>Dispatch = Simple Sentence</h3>
              <p>
                One clause, one action. "Ate eggs." The runtime switches to the right mode and
                runs it once. This is the declarative sentence of the grammar. Every message in
                the original system was a dispatch. It's still the most common shape.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#7dd385"}}>Sequence = Compound Sentence</h3>
              <p>
                "Log lunch and then review my day." Two clauses joined by a coordinating conjunction.
                The runtime executes each step in order, threading the result of one into the context
                of the next. Compound sentences compile to sequences.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#38bdf8"}}>Fork = Conditional Sentence</h3>
              <p>
                "If protein is low, review my meals." The runtime evaluates the condition against
                live data, gets a three valued result (true / false / unknown), and picks the
                branch. Unknown is first class. The system does not guess when data is missing.
                It takes a path that says "I can't determine this yet."
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#f472b6"}}>Fanout = Universal Quantification</h3>
              <p>
                "Review all my exercises." The runtime resolves the set, gathers each item's real
                enriched context, and hands everything to the mode at once. Extensions own their
                vocabulary and decide what "all my X" means inside their domain.
              </p>
            </div>
          </div>

          {/* The Pipeline */}
          <div style={{
            maxWidth: 760, margin: "32px auto", display: "flex", flexDirection: "column", gap: 0,
          }}>
            <p style={{color: "#999", fontSize: "0.9rem", textAlign: "center", marginBottom: 16}}>
              Every message flows through five steps:
            </p>

            <div style={{display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 8}}>
              {[
                { step: "1", label: "Parse Domain", desc: "Noun, pronoun, preposition", color: "#a78bfa" },
                { step: "2", label: "Parse Scope", desc: "Quantifier, temporal window", color: "#fb923c" },
                { step: "3", label: "Parse Intent", desc: "Tense, conditional, negation", color: "#ecc94b" },
                { step: "4", label: "Parse Frame", desc: "Adjective, voice, adverb", color: "#c084fc" },
                { step: "5", label: "Compile + Execute", desc: "Build graph, walk it", color: "#f97316" },
              ].map(s => (
                <div key={s.step} style={{
                  background: "rgba(255,255,255,0.03)", border: `1px solid ${s.color}33`,
                  borderRadius: 8, padding: "12px 10px", textAlign: "center",
                }}>
                  <div style={{color: s.color, fontWeight: 700, fontSize: "0.8rem", marginBottom: 4}}>{s.step}. {s.label}</div>
                  <div style={{color: "#888", fontSize: "0.75rem"}}>{s.desc}</div>
                </div>
              ))}
            </div>
          </div>

          <div style={{
            maxWidth: 700, margin: "24px auto 0", textAlign: "center",
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12, padding: "28px 32px",
          }}>
            <p style={{color: "#e5e5e5", fontSize: "1.1rem", fontWeight: 600, lineHeight: 1.7, marginBottom: 16}}>
              The system is a natural language computer.<br/>
              The seed is the parser. Extensions are the vocabulary.<br/>
              The tree is the syntax tree. The user just talks.
            </p>
            <p style={{color: "#666", fontSize: "0.85rem", lineHeight: 1.6, maxWidth: 580, margin: "0 auto"}}>
              In most AI frameworks, functions are the primary architectural unit. You explicitly
              wire them together: call this, route to that, handle this output. The developer thinks
              in functions. The system is organized around functions. TreeOS inverts this. Functions
              are downstream consequences of grammar, not the organizing principle. You don't call
              a logging function. You stand at a food node and speak in present tense, and logging
              is just what that means. The function fires, but nobody explicitly orchestrated it.
              The grammar did.
            </p>
            <p style={{color: "#555", fontSize: "0.8rem", lineHeight: 1.6, maxWidth: 520, margin: "12px auto 0", fontStyle: "italic"}}>
              When you speak, your mouth calls functions: muscle contractions, air pressure, phoneme
              production. But you don't think in those functions. You think in words. The functions
              are real but they're not where the meaning lives. TreeOS claims the same thing for AI
              systems. Functions exist. They fire. They're just not the level of abstraction that matters.
            </p>
          </div>

          {/* ── HONEST COMPLEXITY ── */}
          <div style={{
            maxWidth: 700, margin: "32px auto 0",
            background: "rgba(251, 146, 60, 0.03)", border: "1px solid rgba(251, 146, 60, 0.12)",
            borderRadius: 12, padding: "24px 28px",
          }}>
            <h3 style={{color: "#fb923c", fontSize: "1rem", marginBottom: 12, textAlign: "center"}}>The Honest Complexity</h3>
            <p style={{color: "#999", fontSize: "0.85rem", lineHeight: 1.7, marginBottom: 14, textAlign: "center"}}>
              The grammar is clean. Three things in the runtime are messier than the story suggests.
              Worth naming them directly.
            </p>
            <div style={{display: "flex", flexDirection: "column", gap: 12}}>
              <div style={{padding: "12px 16px", background: "rgba(0,0,0,0.2)", borderRadius: 8}}>
                <div style={{color: "#fde047", fontSize: "0.82rem", fontWeight: 600, marginBottom: 4}}>Fork evaluation uses an LLM call</div>
                <div style={{color: "#888", fontSize: "0.78rem", lineHeight: 1.6}}>
                  The grammar compiles deterministically. But evaluating "is protein low" against
                  live data needs a small LLM call. Quarantined to one function, three valued result
                  (true / false / unknown), never hallucinates a branch because unknown is allowed.
                  The LLM is in the loop, but it is not in charge.
                </div>
              </div>
              <div style={{padding: "12px 16px", background: "rgba(0,0,0,0.2)", borderRadius: 8}}>
                <div style={{color: "#fde047", fontSize: "0.82rem", fontWeight: 600, marginBottom: 4}}>Extensions own their vocabulary</div>
                <div style={{color: "#888", fontSize: "0.78rem", lineHeight: 1.6}}>
                  "All my exercises" vs "all my runs" vs "all my muscle groups" each mean a different
                  set inside the fitness extension. The kernel stays generic and asks the extension
                  to map keywords to subsets. This is new surface area, but it matches the existing
                  pattern of enrichContext and handleMessage. Extensions opt in to precision.
                </div>
              </div>
              <div style={{padding: "12px 16px", background: "rgba(0,0,0,0.2)", borderRadius: 8}}>
                <div style={{color: "#fde047", fontSize: "0.82rem", fontWeight: 600, marginBottom: 4}}>Condition evaluation walks children</div>
                <div style={{color: "#888", fontSize: "0.78rem", lineHeight: 1.6}}>
                  Extension data is distributed across child nodes with different roles. The food
                  root has no data; its Daily child has it all. So the evaluator walks one level
                  down, collects enriched contexts from each child, and bundles them before deciding.
                  One extra query depth, justified by the tree shape.
                </div>
              </div>
            </div>
            <p style={{color: "#666", fontSize: "0.78rem", lineHeight: 1.6, marginTop: 14, textAlign: "center", fontStyle: "italic"}}>
              The surface grammar is still parts of speech. The runtime is still four primitives.
              These are the seams where the story meets the implementation.
            </p>
          </div>

          <div style={{
            maxWidth: 700, margin: "32px auto 0", textAlign: "center",
            background: "rgba(167, 139, 250, 0.04)", border: "1px solid rgba(167, 139, 250, 0.12)",
            borderRadius: 12, padding: "28px 32px",
          }}>
            <h3 style={{color: "#a78bfa", fontSize: "1rem", marginBottom: 12}}>Two Languages, One Tree</h3>
            <p style={{color: "#ccc", fontSize: "0.9rem", lineHeight: 1.7, marginBottom: 16}}>
              The grammar works in both directions. The user's intent flows in: parsed into
              noun, verb, tense, routed to the right extension in the right mode. But the AI
              also operates through this grammar. Its tools, its context, and its constraints
              are all shaped by where it lives in the tree.
            </p>
            <p style={{color: "#999", fontSize: "0.85rem", lineHeight: 1.7, marginBottom: 16}}>
              At a food node, the AI's context is macros and calories. Its tools are food-specific.
              Its mode determines whether it's logging or reviewing. Move to fitness and everything
              shifts: context becomes sets and reps, tools become workout-specific, the mode
              determines coaching vs planning. Same AI. Different environment. The tree shapes
              what the AI can see, say, and do at every position.
            </p>
            <p style={{color: "#999", fontSize: "0.85rem", lineHeight: 1.7, marginBottom: 16}}>
              This structure mirrors how human concepts actually branch from each other. "Health"
              divides into "Fitness" and "Food." "Fitness" divides into exercises. That's not a
              database schema. That's how concepts relate. The tree structure matches the conceptual
              structure, which is why natural language maps to it without a heavy translation layer.
            </p>
            <p style={{color: "#666", fontSize: "0.85rem", lineHeight: 1.7}}>
              The tree channels the user's intent into extensions, amplifying one sentence into
              mechanical actions across domains. And it gives the AI an environment to inhabit,
              a structure to operate through, a grammar that constrains and guides. The user
              talks to the tree. The tree shapes the AI's response. Both use the same structure.
            </p>
          </div>

          <div style={{
            maxWidth: 700, margin: "24px auto 0",
            background: "rgba(255,255,255,0.02)", border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12, padding: "28px 32px",
          }}>
            <h3 style={{color: "#e5e5e5", fontSize: "1rem", marginBottom: 16, textAlign: "center"}}>The AI Operates Through the Tree</h3>
            <p style={{color: "#ccc", fontSize: "0.9rem", lineHeight: 1.8, marginBottom: 14}}>
              The AI at <code>/Health/Fitness</code> reads the tree to know what exercises exist, what
              weights were lifted, what progressive overload is due. It writes a note to the History
              node. Creates a child under Gym. Updates values on Bench Press. Cascade carries the
              workout signal to the Food branch. The tree is not a database the AI queries. It is
              the environment the AI inhabits and operates through.
            </p>
            <p style={{color: "#999", fontSize: "0.85rem", lineHeight: 1.8, marginBottom: 14}}>
              The human speaks in sentences. "Ate chicken for lunch." The tree parses it. Noun: food.
              Verb: log. Tense: present. The AI receives this through its position-shaped context and
              responds with tree operations: create note, update value, cascade signal. Every memory
              the AI holds is a node with notes. Every communication between domains is a cascade
              signal between branches.
            </p>
            <p style={{color: "#a78bfa", fontSize: "0.9rem", lineHeight: 1.8, textAlign: "center"}}>
              TreeOS was built from studying how concepts branch from each other in natural language.
              The same branching structure that organizes human concepts organizes the AI's environment.
              Most systems translate between human language and machine operations through a fragile
              middle layer. TreeOS structured the translation layer to mirror how concepts actually
              relate. The tree is the shared structure. That's why natural language works as the interface.
            </p>
          </div>
        </div>
      </section>

      {/* ── CLOSING ── */}
      <section className="lp-section" style={{paddingBottom: 60}}>
        <div className="lp-container" style={{textAlign: "center"}}>
          <p style={{
            fontSize: "1.3rem", fontWeight: 700, color: "#e5e5e5", marginBottom: 12,
          }}>
            The kernel handles the plumbing. You build the intelligence.
          </p>
          <p style={{color: "#666", fontSize: "0.95rem", maxWidth: 550, margin: "0 auto"}}>
            MCP connections, session persistence, Chat tracking, abort handling, chain
            indexing, tool resolution, mode switching, hook firing, LLM failover. All
            automatic. Your extension calls one function and the rest happens.
          </p>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/">Get Started</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Read the Guide</a>
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

export default AIArchitecturePage;
