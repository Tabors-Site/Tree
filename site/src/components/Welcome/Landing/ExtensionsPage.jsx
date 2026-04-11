import "./LandingPage.css";
import Particles from "./Particles.jsx";

const ExtensionsPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "55vh"}}>
        <Particles count={25} />
        <div className="lp-hero-inner">
          <h1 className="lp-title">Extensions</h1>
          <p className="lp-subtitle">Capabilities you add to the AI.</p>
          <p className="lp-tagline">
            The kernel gives the AI structure: nodes, notes, conversations. Extensions give it
            everything else. New tools. New knowledge. New ways to think. Install what you need.
            Remove what you don't. Build your own.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
          </div>
        </div>
      </section>

      {/* ── WHAT EXTENSIONS DO ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What Extensions Actually Do</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            An extension is a folder with two files. It plugs into the kernel and changes
            what the AI can do, what it knows, or how it thinks. Three categories cover
            almost everything.
          </p>

          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>New Tools</h3>
              <p style={{fontSize: "0.88rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.8}}>
                Give the AI abilities it didn't have. A tool is a function the AI can call.
                <code>food-log-entry</code> parses "ate a banana" into protein, carbs, fats and writes it to the tree.
                <code>fitness-log-workout</code> records sets, tracks progressive overload, detects PRs.
                <code>create-node-note</code> writes a note.
                Without the extension, the tool doesn't exist.
              </p>
            </div>
            <div className="lp-card">
              <h3>New Knowledge</h3>
              <p style={{fontSize: "0.88rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.8}}>
                Inject context into what the AI sees. When you talk to the AI, extensions
                add data to its awareness through a hook called <code>enrichContext</code>.
                The food extension injects today's macros. The fitness extension injects
                your current program. The recovery extension injects your sleep and energy.
                The AI reads all of it. It knows because extensions told it.
              </p>
            </div>
            <div className="lp-card">
              <h3>New Behaviors</h3>
              <p style={{fontSize: "0.88rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.8}}>
                Change how the AI thinks. Extensions register "modes," each with a different
                system prompt and tool set. A food-log mode knows how to parse meals.
                A food-coach mode asks about your goals. A food-review mode analyzes patterns.
                Navigate to a node and the right mode activates.
                The AI's personality and capability shift based on where you are in the tree.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SIMPLE EXAMPLE: LLM RESPONSE FORMATTING ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">A Simple Extension</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            <strong style={{color: "rgba(255,255,255,0.85)"}}>llm-response-formatting</strong> cleans up how the AI talks.
            It listens to one hook: <code>beforeResponse</code>. Every time the AI is about to
            reply, this extension strips markdown artifacts, fixes broken formatting, and normalizes
            the output. One hook. No tools. No modes. No data. Just a filter on the AI's voice.
          </p>
          <div style={{maxWidth: 680, margin: "20px auto 0"}}>
            <div className="lp-card" style={{padding: "20px 24px"}}>
              <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", marginBottom: 8, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase"}}>What it provides</p>
              <div style={{display: "flex", gap: 24, flexWrap: "wrap", fontSize: "0.88rem"}}>
                <span style={{color: "rgba(255,255,255,0.6)"}}>1 hook listener</span>
                <span style={{color: "rgba(255,255,255,0.3)"}}>0 tools</span>
                <span style={{color: "rgba(255,255,255,0.3)"}}>0 modes</span>
                <span style={{color: "rgba(255,255,255,0.3)"}}>0 routes</span>
                <span style={{color: "rgba(255,255,255,0.3)"}}>0 data</span>
              </div>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.85rem", marginTop: 14, lineHeight: 1.7}}>
                This is the lightest kind of extension. It doesn't store anything. It doesn't give
                the AI new tools. It just intercepts the response on the way out and fixes it.
                Every extension starts this simple. Most of the interesting ones grow from here.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── RICH EXAMPLE: FOOD ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">A Rich Extension</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            <strong style={{color: "rgba(255,255,255,0.85)"}}>food</strong> turns the tree into a nutrition tracker.
            You say "ate chicken and rice." The AI estimates macros, logs them,
            updates your running totals, places the meal in the right time slot,
            and tells you where you stand for the day. One message. Everything handled.
          </p>

          <div style={{maxWidth: 720, margin: "24px auto 0"}}>
            {/* Tree structure */}
            <div className="lp-card" style={{marginBottom: 16}}>
              <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", marginBottom: 12, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase"}}>Tree structure it creates</p>
              <div style={{fontFamily: "monospace", fontSize: "0.85rem", lineHeight: 2, color: "rgba(255,255,255,0.6)"}}>
                <div>Food</div>
                <div style={{paddingLeft: 20}}>Log <span style={{color: "rgba(255,255,255,0.3)"}}>-- where you talk. "ate a banana"</span></div>
                <div style={{paddingLeft: 20}}>Protein <span style={{color: "rgba(255,255,255,0.3)"}}>-- today: 65g, goal: 200g</span></div>
                <div style={{paddingLeft: 20}}>Carbs <span style={{color: "rgba(255,255,255,0.3)"}}>-- today: 120g, goal: 300g</span></div>
                <div style={{paddingLeft: 20}}>Fats <span style={{color: "rgba(255,255,255,0.3)"}}>-- today: 28g, goal: 80g</span></div>
                <div style={{paddingLeft: 20}}>Daily <span style={{color: "rgba(255,255,255,0.3)"}}>-- the advisor. "how am I doing?"</span></div>
                <div style={{paddingLeft: 20}}>Profile <span style={{color: "rgba(255,255,255,0.3)"}}>-- calorie target, restrictions</span></div>
                <div style={{paddingLeft: 20}}>History <span style={{color: "rgba(255,255,255,0.3)"}}>-- daily + weekly summaries</span></div>
                <div style={{paddingLeft: 20}}>Meals</div>
                <div style={{paddingLeft: 44}}>Breakfast, Lunch, Dinner, Snacks</div>
              </div>
            </div>

            {/* What it provides */}
            <div className="lp-card" style={{marginBottom: 16}}>
              <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", marginBottom: 12, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase"}}>What it provides</p>
              <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: "12px 24px", fontSize: "0.88rem"}}>
                <div>
                  <span style={{color: "#7dd385", fontWeight: 600}}>4 modes</span>
                  <span style={{color: "rgba(255,255,255,0.4)", marginLeft: 8}}>log, coach, review, daily</span>
                </div>
                <div>
                  <span style={{color: "#7dd385", fontWeight: 600}}>3 tools</span>
                  <span style={{color: "rgba(255,255,255,0.4)", marginLeft: 8}}>log-entry, save-profile, adopt-node</span>
                </div>
                <div>
                  <span style={{color: "#7dd385", fontWeight: 600}}>5 hooks</span>
                  <span style={{color: "rgba(255,255,255,0.4)", marginLeft: 8}}>enrichContext, afterNote, onCascade...</span>
                </div>
                <div>
                  <span style={{color: "#7dd385", fontWeight: 600}}>3 API routes</span>
                  <span style={{color: "rgba(255,255,255,0.4)", marginLeft: 8}}>daily, history, weekly</span>
                </div>
              </div>
            </div>

            {/* How data lives */}
            <div className="lp-card">
              <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.8rem", marginBottom: 12, fontWeight: 600, letterSpacing: "0.5px", textTransform: "uppercase"}}>Where data lives</p>
              <p style={{color: "rgba(255,255,255,0.55)", fontSize: "0.88rem", lineHeight: 1.8, marginBottom: 12}}>
                No database tables. Every number lives in node metadata.
                The Protein node has <code>metadata.values.today = 65</code> and <code>metadata.goals.today = 200</code>.
                History is a sequence of JSON notes on the History node.
                The Profile is a JSON note. Meals are notes on slot nodes.
              </p>
              <p style={{color: "rgba(255,255,255,0.55)", fontSize: "0.88rem", lineHeight: 1.8}}>
                When you talk at the Food tree, the <code>enrichContext</code> hook assembles all of this
                into the AI's context. The AI sees: "Protein: 65/200g. Carbs: 120/300g. Last meal: chicken
                and rice at 12:30pm." It didn't look this up. The extension injected it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── MORE EXAMPLES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Extensions Create Everything</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every feature you see in TreeOS is an extension. The dashboard, notifications,
            the chat interface, fitness coaching, billing, federation. Here are a few more examples
            of what extensions look like at different scales.
          </p>
          <div style={{maxWidth: 700, margin: "0 auto"}}>
            {[
              ["console", "Formats log output in the terminal. Colors, timestamps, alignment. One file, no tools, no data."],
              ["navigation", "Tracks where users go. Adds cd and ls commands. Stores recent roots in user metadata."],
              ["notifications", "Push notifications across channels. Registers a socket handler and a background job."],
              ["persona", "Gives the AI a custom identity per node. Stores personality in metadata. Injects it through enrichContext."],
              ["tree-orchestrator", "Replaces the entire conversation flow. Routes messages to the right extension's mode based on content and position. The most powerful extension type."],
              ["gateway", "Opens the tree to external channels. Discord, Telegram, Slack, email, SMS. Each channel type is its own sub-extension. Together they form the rain layer."],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", gap: 16, padding: "14px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <span style={{color: "#7dd385", minWidth: 160, fontSize: "0.88rem", fontWeight: 600, fontFamily: "monospace"}}>{name}</span>
                <span style={{color: "rgba(255,255,255,0.5)", fontSize: "0.88rem", lineHeight: 1.7}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── BUNDLES ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Bundles</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Extensions group into bundles. Install a bundle and you get a coordinated set of
            capabilities. Remove one extension and the rest keep working. Four bundles cover
            the major systems.
          </p>

          <div style={{maxWidth: 720, margin: "0 auto"}}>
            <div style={{marginBottom: 36}}>
              <h3 style={{color: "#7dd385", fontSize: "1rem", marginBottom: 8}}>treeos-cascade <span style={{color: "rgba(255,255,255,0.3)", fontWeight: 400}}>8 extensions</span></h3>
              <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem"}}>
                The nervous system. When content is written, signals propagate through the tree.
                Each node can filter what it receives. Signals compress into shared vocabulary.
                Missing capabilities surface automatically. Health is monitored. Flow is visible.
              </p>
              <p style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem", marginTop: 8}}>
                propagation, perspective-filter, sealed-transport, codebook, gap-detection, long-memory, pulse, flow
              </p>
            </div>

            <div style={{marginBottom: 36}}>
              <h3 style={{color: "#7dd385", fontSize: "1rem", marginBottom: 8}}>treeos-connect <span style={{color: "rgba(255,255,255,0.3)", fontWeight: 400}}>8 extensions</span></h3>
              <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem"}}>
                External channels. Discord messages become tree conversations. Telegram chats
                reach specific nodes. Email through any SMTP. SMS through Twilio. Slack, Matrix,
                webhooks. Each channel registers with the gateway and gets access control,
                energy metering, and queue management automatically.
              </p>
              <p style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem", marginTop: 8}}>
                gateway, gateway-telegram, gateway-discord, gateway-email, gateway-sms, gateway-slack, gateway-matrix, gateway-webhook
              </p>
            </div>

            <div style={{marginBottom: 36}}>
              <h3 style={{color: "#7dd385", fontSize: "1rem", marginBottom: 8}}>treeos-intelligence <span style={{color: "rgba(255,255,255,0.3)", fontWeight: 400}}>14 extensions</span></h3>
              <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem"}}>
                Self-awareness. The tree compresses what it's learned upward. Contradictions surface.
                User behavior is modeled. Structure evolves based on what works. Semantic search
                connects related content. The tree tracks where its knowledge ends. Intent
                synthesizes all of this into autonomous actions the tree takes on its own.
              </p>
              <p style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem", marginTop: 8}}>
                tree-compress, contradiction, inverse-tree, evolution, intent, embed, scout, explore, trace, boundary, competence, reflect, evolve, rings
              </p>
            </div>

            <div style={{marginBottom: 12}}>
              <h3 style={{color: "#7dd385", fontSize: "1rem", marginBottom: 8}}>treeos-maintenance <span style={{color: "rgba(255,255,255,0.3)", fontWeight: 400}}>5 extensions</span></h3>
              <p style={{color: "rgba(255,255,255,0.5)", lineHeight: 1.8, fontSize: "0.88rem"}}>
                Hygiene. Dead nodes get pruned. Content gets reorganized based on semantic similarity.
                Changes get narrated. Daily briefings assemble from every installed extension. Stuck
                work gets matched to available people.
              </p>
              <p style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem", marginTop: 8}}>
                prune, reroot, changelog, digest, delegate
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── SECURITY ── */}
      <section className="lp-section lp-section-alt" style={{paddingTop: 40, paddingBottom: 40}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <div style={{
            padding: "24px 28px",
            background: "rgba(201, 126, 106, 0.08)",
            border: "1px solid rgba(201, 126, 106, 0.25)",
            borderRadius: 10,
          }}>
            <h3 style={{color: "#c97e6a", fontSize: "1rem", marginTop: 0, marginBottom: 12}}>
              Review every extension before you install it.
            </h3>
            <p style={{color: "rgba(255,255,255,0.55)", lineHeight: 1.8, fontSize: "0.88rem", margin: "0 0 12px"}}>
              Extensions run in the same process as the kernel. They can access your file system,
              make network calls, and execute shell commands. A malicious extension with the right
              tools can do real damage. Read the code. Check what hooks it listens to, what tools
              it registers, what services it declares.
            </p>
            <p style={{color: "rgba(255,255,255,0.4)", lineHeight: 1.8, fontSize: "0.85rem", margin: 0}}>
              Use spatial scoping to confine dangerous extensions to specific branches.
              <code style={{color: "#c97e6a"}}> ext-allow shell</code> at /DevOps gives it access there only.
              The rest of your tree never sees it.
            </p>
          </div>
        </div>
      </section>

      {/* ── HOW THEY WORK (developer section, below the fold) ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">How Extensions Work</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Two files. A manifest declares dependencies and capabilities. An init function wires everything in.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>manifest.js</h3>
              <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.45)"}}>
                <code>needs</code>: models, services, other extensions.
                <code> optional</code>: graceful degradation if missing.
                <code> provides</code>: CLI commands, env vars, energy actions.
                The loader reads it before calling any code. Unmet needs = extension skipped.
              </p>
            </div>
            <div className="lp-card">
              <h3>init(core)</h3>
              <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.45)"}}>
                Receives the core services bundle. Returns any combination of:
                <code> router</code> (HTTP routes),
                <code> tools</code> (MCP tools for the AI),
                <code> jobs</code> (background tasks),
                <code> exports</code> (for other extensions).
                Registers hooks, modes, orchestrators through core.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── FIVE REGISTRIES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Five Registries</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Same pattern across all five. Extensions register. The kernel resolves.
          </p>
          <div style={{maxWidth: 700, margin: "0 auto"}}>
            {[
              ["Hooks", "Lifecycle events. 30 kernel hooks. before hooks can cancel. after hooks react. Extensions fire their own."],
              ["Modes", "AI conversation modes. How the AI thinks at each position. Per-node overrides let you change behavior anywhere."],
              ["Orchestrators", "Conversation flow. The entire chat pipeline is replaceable. Swap it and you control every AI interaction."],
              ["Socket Handlers", "Real-time events. Extensions add WebSocket features without touching kernel code."],
              ["Auth Strategies", "Authentication methods. JWT is built-in. API keys, share tokens, public access are all extensions."],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", gap: 16, padding: "14px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <span style={{color: "#7dd385", minWidth: 140, fontSize: "0.88rem", fontWeight: 600}}>{name}</span>
                <span style={{color: "rgba(255,255,255,0.45)", fontSize: "0.85rem", lineHeight: 1.7}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── SPATIAL SCOPING ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Position Determines Capability</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Block an extension at a node and it disappears from that node and every child.
            Tools, hooks, modes, metadata writes. All gone. Allow a confined extension at a
            specific branch and it activates only there.
          </p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3>Global (opt-out)</h3>
              <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.45)"}}>
                Active everywhere by default. <code>ext-block shell</code> removes it at a node
                and all descendants. Most extensions work this way.
              </p>
            </div>
            <div className="lp-card">
              <h3>Confined (opt-in)</h3>
              <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.45)"}}>
                Active nowhere by default. <code>ext-allow solana</code> activates it at a node
                and all descendants. For dangerous or specialized capabilities.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── OS CONCEPT ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">An Operating System Is Just Extensions Working Together</h2>

          <div style={{fontSize: "0.88rem", margin: "0 auto 28px", maxWidth: 560}}>
            {[
              ["The Seed", "structure, intelligence, extensibility, communication", "#7dd385"],
              ["Extensions", "capabilities, tools, modes, hooks, jobs, orchestrators", "#a8c0e0"],
              ["Trees", "applications (food, fitness, CRM, journal, anything)", "#c4afde"],
            ].map(([layer, desc, color]) => (
              <div key={layer} style={{padding: "10px 0", borderBottom: "1px solid rgba(255,255,255,0.05)", display: "flex", gap: 16, alignItems: "baseline"}}>
                <span style={{color, fontWeight: 700, minWidth: 100}}>{layer}</span>
                <span style={{color: "rgba(255,255,255,0.45)"}}>{desc}</span>
              </div>
            ))}
          </div>

          <p className="lp-section-sub lp-section-sub-wide">
            Enough extensions built on a kernel form an operating system.
            Swap any of them and you get a different OS. A medical OS. A coding OS.
            A research OS. The kernel stays the same. The extensions define the experience.
          </p>
          <div className="lp-cta-row">
            <a className="lp-btn lp-btn-primary" href="/build">Build an Extension</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Browse on Horizon</a>
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

export default ExtensionsPage;
