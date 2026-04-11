import "./LandingPage.css";
import Particles from "./Particles.jsx";

const Guide = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "50vh"}}>
        <Particles count={25} />
        <div className="lp-hero-inner">
          <h1 className="lp-title">The Guide</h1>
          <p className="lp-subtitle">An operating system for AI agents. Built to last.</p>
          <p className="lp-tagline">
            A minimal kernel. Modular extensions. Trees that hold data, run AI, and connect
            to each other across a federated network. Everything below explains how.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/">Home</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
            <a className="lp-btn lp-btn-secondary" href="/build">Build</a>
            <a className="lp-btn lp-btn-secondary" href="/use">Use</a>
            <a className="lp-btn lp-btn-secondary" href="/cli">CLI</a>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 1. THE IDEA */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The Idea</h2>
          <P>
            You plant a seed on a server. It grows trees. Each tree is a hierarchy of nodes
            where AI lives permanently. It builds structure, accumulates knowledge, tracks data,
            and talks to people through any channel. Navigate to a position in the tree and the AI
            changes what it can do, what it knows, and how it thinks. Position determines reality.
          </P>
          <P>
            The kernel is minimal. Two database schemas (Node and User), a conversation loop, a hook
            system, a cascade engine, and an extension loader. Everything else is an extension you
            install. Strip every extension and the kernel still boots. It defines the contract that
            everything builds on.
          </P>
          <P>
            TreeOS is one operating system built on the kernel. 120 extensions across four bundles
            plus base and standalone. But TreeOS is just one interpretation. A medical platform, a
            code review pipeline, a research assistant could all be built on the same kernel.
            Same relationship as Linux and Ubuntu. The kernel is the seed. The extensions are the
            distribution.
          </P>
          <P>
            <a href="/seed" style={{color: "#7dd385"}}>Deep dive: The Seed (kernel architecture)</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 2. WHAT IT LOOKS LIKE */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">What It Looks Like</h2>
          <P>
            A personal tree connected to Telegram. You text it thoughts throughout the day. It captures
            and places them into the right branch. Navigate to /Health/Food and say "ate chicken and rice."
            It parses macros, updates your running totals, tells you where you stand. Navigate to
            /Health/Fitness and say "bench 135x10,10,8." It records sets, tracks progressive overload,
            detects when you're ready for more weight. Different position, different AI.
          </P>
          <P>
            A research community tree with branches per topic. Reddit comments arrive through a
            gateway channel and get placed into the right branch. The intelligence bundle works in
            the background. The tree compresses its own knowledge. It detects contradictions between
            branches. A digest goes out each morning via Telegram. The tree monitors what it knows,
            what it doesn't, and where the gaps are.
          </P>
          <P>
            A company tree where each department is a branch. The AI at /Engineering has access to
            shell commands and code review tools. The AI at /Sales has CRM tools and email gateway.
            The AI at /Finance has transaction tracking and reporting. Same kernel. Same conversation
            loop. Different extensions activated at each position through spatial scoping.
          </P>
          <P style={{color: "rgba(255,255,255,0.4)", fontSize: "0.9rem"}}>
            A persistent AI that lives in a structure, accumulates context across every channel,
            knows itself, communicates internally through cascade signals, and connects to the
            outside world through gateways. Every extension reads from every other. The whole is
            more than the parts.
          </P>
          <P>
            <a href="/use" style={{color: "#7dd385"}}>See the apps built on TreeOS</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 12px"}}>.</span>
            <a href="/food" style={{color: "rgba(255,255,255,0.5)"}}>Food</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 8px"}}>.</span>
            <a href="/fitness" style={{color: "rgba(255,255,255,0.5)"}}>Fitness</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 3. QUICK START */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Quick Start</h2>
          <P>Run your own land (server):</P>
          <Code>{`npx create-treeos my-land
cd my-land
node boot.js`}</Code>
          <P>First boot walks you through setup: domain, name, LLM connection, extension selection. Any OpenAI-compatible endpoint works: Ollama, OpenRouter, Anthropic, local models.</P>
          <P>Or connect to an existing land as a user:</P>
          <Code>{`npm install -g treeos
treeos connect https://treeos.ai
treeos register
treeos start`}</Code>
          <P>
            <a href="/land" style={{color: "#7dd385"}}>Full setup guide: Start a Land</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 12px"}}>.</span>
            <a href="/cli" style={{color: "rgba(255,255,255,0.5)"}}>CLI reference</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 4. THE VOCABULARY */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The Vocabulary</h2>
          <div style={{maxWidth: 650, margin: "0 auto"}}>
            {[
              ["Seed", "The kernel. Two schemas, conversation loop, hooks, cascade, extension loader. The foundation everything builds on."],
              ["Land", "One running server. One database. One seed. The ground everything grows from."],
              ["Tree", "A root node with children. The data structure users and AI work in. Trees hold applications."],
              ["Node", "One item in a tree. Has a name, type, status, children, parent, and a metadata Map where extensions store everything."],
              ["Note", "Text or file content attached to a node. The primary data unit."],
              ["Extension", "A folder with a manifest and an init function. Adds capabilities: tools, modes, hooks, routes, jobs."],
              ["Mode", "How the AI thinks at a position. A system prompt plus a tool set. Extensions register them."],
              ["Cascade", "Signals that flow between nodes when content is written. The tree's internal communication."],
              ["Canopy", "The federation protocol. How lands discover and connect to each other."],
              ["Horizon", "The public directory at horizon.treeos.ai. Lands register here to be discovered. Extensions are published here. Anyone can host their own Horizon."],
              ["Zone", "Land (/), Home (~), or Tree (/MyTree). Where you are determines what the AI can do."],
              ["runChat", "One LLM call with session persistence. Extensions use this for single AI interactions. Handles MCP connection, mode switching, chat tracking, and abort automatically."],
              ["Orchestrator", "The entire conversation flow. Classifies intent, routes to the right extension and mode, chains multi-extension messages. The built-in tree-orchestrator is itself an extension. Replace it and you control every AI interaction."],
              ["Land Zone", "The root position (/). The public face of the server. Visitors from other lands arrive here. Public trees are discoverable here. For admins, the AI manages extensions, config, users, peers, and Horizon registration."],
              ["Home Zone", "Your personal space (~). See all your trees, recent activity, contributions. Capture raw ideas. Chat without tree context. The user-focused hub where everything is visible."],
            ].map(([term, desc]) => (
              <div key={term} style={{padding: "12px 0", borderBottom: "1px solid rgba(255,255,255,0.06)"}}>
                <span style={{color: "#7dd385", fontWeight: 700, marginRight: 12}}>{term}</span>
                <span style={{color: "rgba(255,255,255,0.55)", fontSize: "0.95rem"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 5. THREE ZONES */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Three Zones</h2>
          <P>
            Where you are determines what the AI can do. No mode switching menu. Navigation IS
            mode switching. <code>cd /</code> and the AI becomes a system operator.
            <code> cd ~</code> and it becomes your personal assistant. <code>cd MyTree</code> and
            it works the tree with you.
          </P>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3 style={{color: "#d4a574"}}>Land <code>/</code></h3>
              <p>System management. Extensions, config, users, peers, diagnostics. Admin access required.</p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#a8c0e0"}}>Home <code>~</code></h3>
              <p>Personal space. Raw ideas, notes, chat history, contributions. Organize and reflect.</p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#7dd385"}}>Tree <code>/MyTree</code></h3>
              <p><strong>Chat</strong> reads and writes. <strong>Place</strong> adds content silently. <strong>Query</strong> reads only. <strong>Be</strong> lets the tree guide you. The orchestrator classifies intent.</p>
            </div>
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 6. HOW AI WORKS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">How AI Works</h2>
          <P>
            You send a message. The orchestrator (itself an extension) classifies it. Is it about
            food? Fitness? A general question? It routes to the right extension's mode. The mode
            sets the AI's system prompt and available tools. The AI responds, calling tools as needed
            through <a href="/ai" style={{color: "rgba(255,255,255,0.7)"}}>MCP</a>. One
            message can trigger multiple tool calls in a loop until the AI is done or hits the
            iteration cap.
          </P>
          <P>
            Every prompt starts with a position block the AI can't skip. It always knows where it
            is: which tree, which node, which user.
          </P>
          <Code>{`[Position]
User: tabor
Tree: My Fitness (abc-123-def)
Current node: Push Day (xyz-456-ghi)

You are tabor's personal fitness coach...

Current time: Friday, April 11, 2026, 7:42 AM EDT`}</Code>
          <P>
            Extensions inject context through the <code>enrichContext</code> hook. The food extension
            adds today's macros. The fitness extension adds the current program. The recovery extension
            adds sleep and energy. The AI reads all of it. It knows because extensions told it.
          </P>
          <P>
            Five resolution chains determine what happens at every position: extension scope (what's
            active here), tool scope (what tools the AI has), mode resolution (which prompt fires),
            LLM resolution (which model runs), and LLM config (iteration limits, timeouts).
            All walk the same cached ancestor snapshot. One DB query serves all five.
          </P>
          <P>
            <a href="/ai" style={{color: "#7dd385"}}>Deep dive: The AI</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 7. EXTENSIONS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Extensions</h2>
          <P>
            A folder with two files. A manifest declares what it needs and provides. An init function
            wires it in. Extensions give the AI new tools (what it can do), new knowledge (what it
            knows via enrichContext), and new behaviors (how it thinks via modes).
          </P>
          <P>
            120 extensions ship with TreeOS. From a one-hook response formatter to a full conversation
            orchestrator that routes every message. From a nutrition tracker that parses "ate a banana"
            into protein, carbs, and fats to a gateway system that opens trees to Discord, Telegram,
            Slack, email, SMS, Reddit, and Matrix.
          </P>
          <P>
            <strong>Spatial scoping</strong> controls where extensions are active. Block an extension
            at any node and it loses all power there and below. Tools disappear. Hooks stop firing.
            Modes don't resolve. Confined extensions (like shell, solana) are active nowhere until
            you explicitly allow them at a specific branch.
          </P>
          <Code>{`treeos ext-block shell         # shell tools gone from here and below
treeos ext-allow solana        # solana tools activated at this branch only
treeos ext-scope               # see what's active at this position`}</Code>
          <P>
            Extensions communicate through three patterns: <strong>hooks</strong> (pub/sub events),
            <strong> exports</strong> (direct function calls via <code>getExtension()</code>), and
            <strong> metadata</strong> (shared state on nodes). They never import each other directly.
            The kernel is the bus.
          </P>
          <P>
            <a href="/extensions" style={{color: "#7dd385"}}>Deep dive: Extensions</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 12px"}}>.</span>
            <a href="/build" style={{color: "rgba(255,255,255,0.5)"}}>Build your own</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 12px"}}>.</span>
            <a href="https://horizon.treeos.ai" style={{color: "rgba(255,255,255,0.5)"}}>Browse on Horizon</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 8. THE TREE-AS-APP */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The Tree IS the App</h2>
          <P>
            The tree structure is not a database for an application. It IS the application.
            A food tree has a Log node where you talk, metric nodes that count protein, carbs,
            and fats, a Meals subtree that tracks patterns by slot, and a History node that archives
            daily summaries. A fitness tree has muscle groups, exercise nodes with sets and weight,
            a program node, and a history node. You say what you ate. One tool call parses and
            stores it. You say what you lifted. Same pattern.
          </P>
          <P>
            Neither food nor fitness knows the other exists. But a channel between them carries
            data both ways. The fitness AI sees today's calories. The food AI sees today's workout.
            The tree connected them. Not the code. The structure.
          </P>

          <div style={{fontSize: "0.9rem", marginTop: 24, marginBottom: 12}}>
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

          <P style={{marginTop: 16}}>
            Most things people build will be tree shapes, not extensions. Extensions add capabilities.
            Trees arrange them into applications. The distinction tells you when to write code and
            when to just build structure.
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 9. THE SEED */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The Seed</h2>
          <P>
            Four primitives. <strong>Structure</strong>: Node (12 fields) and User (7 fields) plus
            a metadata Map where extensions store everything.
            <strong> Intelligence</strong>: the conversation loop, LLM resolution, tool execution
            via MCP.
            <strong> Extensibility</strong>: the loader, 30 hooks, 5 registries (hooks, modes,
            orchestrators, socket handlers, auth strategies).
            <strong> Communication</strong>: cascade signals, .flow result storage, the response protocol.
          </P>
          <P>
            Six system nodes at boot: Land Root, .identity (Ed25519 keys), .config (all runtime
            config), .peers (federation), .extensions (registry), .flow (cascade results in daily
            partitions).
          </P>
          <P>
            Six rules, never violated: seed never imports from extensions, extensions import from
            seed, extensions reach each other through getExtension() or hooks, extension data lives
            in metadata Maps, seed schemas never change, zero getExtension() calls in seed.
          </P>
          <P>
            <a href="/seed" style={{color: "#7dd385"}}>Deep dive: The Seed</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 10. HOOKS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">30 Hooks</h2>
          <P>
            An open pub/sub bus. Before hooks run sequentially and can cancel. After hooks
            run in parallel and react. Any hook name is valid. Extensions fire their own
            with <code>extName:hookName</code> convention.
          </P>
          <div style={{maxWidth: 600, margin: "0 auto", fontSize: "0.85rem"}}>
            {[
              ["beforeNote / afterNote", "Note lifecycle"],
              ["beforeNodeCreate / afterNodeCreate", "Node creation"],
              ["beforeStatusChange / afterStatusChange", "Status changes"],
              ["beforeNodeDelete", "Deletion, cleanup"],
              ["beforeContribution", "Contribution data modification"],
              ["enrichContext", "Inject extension data into AI context (sequential)"],
              ["beforeLLMCall / afterLLMCall", "LLM API call lifecycle"],
              ["beforeToolCall / afterToolCall", "MCP tool execution"],
              ["beforeResponse", "Modify AI response before client"],
              ["beforeRegister / afterRegister", "User registration"],
              ["afterSessionCreate / afterSessionEnd", "Session lifecycle"],
              ["afterNavigate / onNodeNavigate", "Navigation events"],
              ["afterNodeMove", "Node reparented"],
              ["afterMetadataWrite", "Metadata changes"],
              ["afterScopeChange", "Extension scope changes"],
              ["afterOwnershipChange", "Ownership changes"],
              ["afterBoot", "Post-boot setup"],
              ["onCascade", "Cascade signal handler (sequential)"],
              ["onDocumentPressure", "Document approaching size limit"],
              ["onTreeTripped / onTreeRevived", "Circuit breaker events"],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", justifyContent: "space-between", padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.04)", gap: 12,
              }}>
                <code style={{color: "#7dd385", fontSize: "0.8rem", whiteSpace: "nowrap"}}>{name}</code>
                <span style={{color: "rgba(255,255,255,0.4)", textAlign: "right"}}>{desc}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 11. CASCADE */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Cascade</h2>
          <P>
            When content is written at a cascade-enabled node, the kernel fires <code>onCascade</code>.
            Extensions propagate signals to children, siblings, or remote lands. Every signal
            produces a visible result stored in .flow with daily partitions.
          </P>
          <P>
            Two entry points. <code>checkCascade</code> fires automatically on content writes.
            <code> deliverCascade</code> is called by extensions to propagate externally. The kernel
            never blocks inbound signals. Always accepts. Always writes a result.
          </P>
          <P>
            Six result statuses: succeeded, failed, rejected, queued, partial, awaiting. Results
            stored in daily partition nodes under .flow. This is how the food extension routes
            macros to metric nodes, how fitness routes workout data to exercise nodes, and how
            signals flow between trees across lands.
          </P>
          <P>
            <a href="/cascade" style={{color: "#7dd385"}}>Deep dive: Cascade</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 12px"}}>.</span>
            <a href="/flow" style={{color: "rgba(255,255,255,0.5)"}}>The Flow</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 12. CLI */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">The CLI</h2>
          <P>
            Navigate trees like a filesystem. <code>cd</code>, <code>ls</code>,
            <code> mkdir</code>, <code>rm</code>, <code>mv</code>. Extension commands appear
            automatically based on what the connected land has installed.
          </P>
          <Code>{`treeos cd Life/Health/Fitness
treeos chat "bench 135x10,10,8"
treeos be                # the tree guides you through your workout
treeos note "Hit PR on squat today"
treeos query "how's my progress this month"
treeos tree              # see the structure
treeos ext-scope         # see what's active here`}</Code>
          <P style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem"}}>
            The CLI is built for TreeOS. It is not part of the kernel. Anyone building on the seed
            can build their own CLI, frontend, or interface. TreeOS also has a web dashboard,
            server-rendered HTML pages, and a standalone chat interface.
          </P>
          <P>
            <a href="/cli" style={{color: "#7dd385"}}>Full CLI reference</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 13. LLM SYSTEM */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">LLM System</h2>
          <P>
            Model-agnostic. Any OpenAI-compatible endpoint: Ollama, OpenRouter, Anthropic, local
            models, custom deployments. Each user has a default LLM connection. Tree owners can
            override per-tree. Extensions register additional LLM slots for per-mode assignments.
            API key is not required for local models like Ollama.
          </P>
          <P>
            Resolution chain: extension slot on tree, tree default, extension slot on user, user
            default. First match wins. Failover on errors. Priority queue ensures human sessions
            run before background jobs.
          </P>
          <Code>{`treeos llm add            # add a connection (Ollama, OpenRouter, etc)
treeos llm assign         # assign to a specific tree or mode`}</Code>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 14. FEDERATION */}
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
            Peers discover each other through the <a href="https://horizon.treeos.ai" style={{color: "rgba(255,255,255,0.7)"}}>Horizon</a> or
            by direct peering. The Horizon is discovery, not authority. Remove it and peering still
            works. Messages are signed with Ed25519 keys. Cascade signals flow between lands. A tree
            on Land A writes content. An extension propagates to Land B via Canopy. Land B accepts it,
            fires onCascade, writes to .flow.
          </P>
          <P>
            <a href="/network" style={{color: "#7dd385"}}>Deep dive: The Network</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 12px"}}>.</span>
            <a href="/mycelium" style={{color: "rgba(255,255,255,0.5)"}}>Mycelium (intelligent routing)</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 15. BUNDLES */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Bundles</h2>
          <P>
            Extensions group into bundles. Install a bundle and the loader resolves everything.
            Remove one extension and the rest keep working.
          </P>
          <div style={{fontSize: "0.88rem"}}>
            {[
              ["base TreeOS", "21", "Core experience. Orchestrator, navigation, dashboard, notifications, console, HTML rendering, team, channels, heartbeat, purpose, phase, remember, breath."],
              ["treeos-cascade", "8", "The nervous system. Signal propagation, perspective filtering, sealed transport, codebook compression, gap detection, long memory, pulse monitoring, flow visualization."],
              ["treeos-intelligence", "14", "Self-awareness. Context compression, contradiction detection, user modeling, evolution tracking, semantic search, boundary detection, competence tracking, reflection, autonomous intent."],
              ["treeos-connect", "11", "External channels. Gateway core plus Discord, Telegram, Slack, email, SMS, Matrix, Reddit, X, webhooks, tree-to-tree."],
              ["treeos-maintenance", "5", "Hygiene. Pruning, rerooting, changelog, daily digest, work delegation."],
              ["standalone", "8+", "Persona, mycelium, peer-review, seed-export, governance, teach, split, approve."],
            ].map(([name, count, desc]) => (
              <div key={name} style={{padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.05)"}}>
                <div style={{display: "flex", gap: 8, alignItems: "baseline", marginBottom: 4}}>
                  <span style={{color: "#7dd385", fontWeight: 600}}>{name}</span>
                  <span style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem"}}>{count} extensions</span>
                </div>
                <p style={{color: "rgba(255,255,255,0.45)", margin: 0, lineHeight: 1.7, fontSize: "0.85rem"}}>{desc}</p>
              </div>
            ))}
          </div>
          <Code style={{marginTop: 16}}>{`treeos ext install treeos-cascade      # install a bundle
treeos ext install persona              # install standalone
treeos ext publish my-extension         # publish your own`}</Code>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 16. KERNEL CONFIG */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Kernel Config</h2>
          <P>
            Every tunable value lives in the .config system node. Readable and writable via CLI,
            API, or the land-manager AI. No code editing. No restarts for most values.
            100+ config keys covering LLM, conversation, sessions, notes, cascade, uploads,
            circuit breakers, and more.
          </P>
          <Code>{`treeos config set maxToolIterations 25
treeos config set llmTimeout 900
treeos config set cascadeEnabled true
treeos config set treeCircuitEnabled true`}</Code>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 17. CONCURRENCY + SAFETY */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Concurrency and Safety</h2>
          <P>
            The tree is multi-agent. Multiple users, sessions, background jobs, gateway channels,
            cascade signals. Reads are fully concurrent. Scoped writes (metadata per namespace) are
            concurrent across namespaces. Structural mutations (create, move, delete) use sorted
            node locks with 30s TTL.
          </P>
          <P>
            The kernel protects itself: hook circuit breakers auto-disable failing handlers, tool
            circuit breakers disable broken tools per session, tree circuit breakers trip unhealthy
            trees. Document size guards prevent runaway metadata. Ancestor caches prevent N+1 queries.
            LLM priority queues ensure humans run before background jobs.
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 18. BUILDING */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
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
            An operating system is just extensions working together. The seed grows whatever you plant.
          </P>
          <P>
            <a href="/build" style={{color: "#7dd385"}}>Full developer reference</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 12px"}}>.</span>
            <a href="https://horizon.treeos.ai" style={{color: "rgba(255,255,255,0.5)"}}>Browse extensions on Horizon</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 19. API + PROTOCOL */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
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
            that mean something.
          </P>
          <P>
            <a href="/about/api" style={{color: "#7dd385"}}>Full API reference</a>
          </P>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 20. LICENSE */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
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

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 21. THREE TEMPORAL LAYERS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Three Temporal Layers</h2>
          <P>
            The tree exists in time. Three extensions operate at different frequencies. Stack all three
            and you get the tree's complete waveform.
          </P>
          <div style={{fontSize: "0.9rem"}}>
            {[
              ["Phase", "seconds to minutes", "#7dd385",
                "Detects awareness vs attention in conversation. The AI adjusts its approach in real time."],
              ["Breath", "minutes to hours", "#a8c0e0",
                "Activity-driven metabolism. Fast when active. Slow when quiet. Stops when dormant. Extensions listen to exhale instead of running their own timers."],
              ["Rings", "months to years", "#c4afde",
                "Growth, peak, hardening, dormancy. Each ring records who the tree was during that period. The tree remembers every age."],
            ].map(([name, scale, color, desc]) => (
              <div key={name} style={{padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)"}}>
                <div style={{display: "flex", gap: 12, alignItems: "baseline", marginBottom: 6}}>
                  <span style={{color, fontWeight: 700, fontSize: "1rem"}}>{name}</span>
                  <span style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem"}}>{scale}</span>
                </div>
                <p style={{color: "rgba(255,255,255,0.45)", margin: 0, lineHeight: 1.7}}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 22. THREE COMMUNICATION LAYERS */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">Three Communication Layers</h2>
          <P>
            The kernel provides one primitive: onCascade. Three layers emerge from extensions using
            it at different scales.
          </P>
          <div style={{fontSize: "0.9rem"}}>
            {[
              [".flow", "The water table", "#7dd385",
                "Local to one land. Cascade results pool in daily partitions. Trees pull what they need through perspective filters. The land's groundwater."],
              ["Canopy", "Trees reaching out", "#a8c0e0",
                "Direct land-to-land peering. Ed25519 signed. Intentional. deliverCascade sends signals across lands. The remote kernel accepts, fires onCascade, writes to .flow."],
              ["Mycelium", "The intelligent underground", "#c4afde",
                "An extension any land installs to become a routing node. Reads signal metadata, evaluates what each connected land needs, delivers where useful. The forest's nervous system between roots."],
            ].map(([name, label, color, desc]) => (
              <div key={name} style={{padding: "16px 0", borderBottom: "1px solid rgba(255,255,255,0.05)"}}>
                <div style={{display: "flex", gap: 12, alignItems: "baseline", marginBottom: 6}}>
                  <span style={{color, fontWeight: 700, fontSize: "1rem"}}>{name}</span>
                  <span style={{color: "rgba(255,255,255,0.35)", fontSize: "0.85rem"}}>{label}</span>
                </div>
                <p style={{color: "rgba(255,255,255,0.45)", margin: 0, lineHeight: 1.7}}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ══════════════════════════════════════════════════════════════ */}
      {/* 23. WHAT THE SEED ENABLES */}
      {/* ══════════════════════════════════════════════════════════════ */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 800}}>
          <h2 className="lp-section-title">What the Seed Enables</h2>
          <P>
            The kernel does not know about fitness, food, wallets, blogs, scripts, energy budgets,
            dream cycles, or gateway channels. It does not render HTML. It does not meter usage.
            It does not schedule tasks. It does not propagate signals.
          </P>
          <P>
            It provides structure, intelligence, extensibility, and communication.
            Extensions provide meaning. The kernel is 12 fields on a node, 7 fields on a user,
            a conversation loop, 30 hooks, 5 registries, a cascade engine, and a response protocol.
            Everything else is an extension someone built.
          </P>
          <P>
            The seed is small so the tree can be anything.
          </P>
        </div>
      </section>

      {/* ── LINKS ── */}
      <section className="lp-section lp-section-alt" style={{paddingTop: 40, paddingBottom: 40}}>
        <div className="lp-container" style={{textAlign: "center"}}>
          <div style={{display: "flex", gap: 12, justifyContent: "center", flexWrap: "wrap"}}>
            <a className="lp-btn lp-btn-secondary" href="/">Home</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/flow">The Flow</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
            <a className="lp-btn lp-btn-secondary" href="/build">Build</a>
            <a className="lp-btn lp-btn-secondary" href="/network">The Network</a>
            <a className="lp-btn lp-btn-secondary" href="/use">Use</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Horizon</a>
            <a className="lp-btn lp-btn-secondary" href="https://github.com/taborgreat/TreeOS">GitHub</a>
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
              ["uploadCleanupBatchSize", "1000", "Max files deleted per cleanup cycle"],
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
              ["ancestorCacheMaxDepth", "100", "Parent chain depth limit"],
              ["maxContributorsPerNode", "500", "Max contributors per node"],
              ["metadataMaxNestingDepth", "5", "Max metadata nesting depth"],
              ["mcpConnectRetries", "2", "MCP reconnect attempts for pipelines"],
              ["contributionQueryLimit", "5000", "Max contribution docs per query"],
              ["noteQueryLimit", "5000", "Max notes per query"],
              ["noteSearchLimit", "500", "Max notes per search"],
              ["subtreeNodeCap", "10000", "Max nodes in subtree traversal"],
              ["circuitFlowScanLimit", "5000", "Max cascade results scanned per health check"],
              ["treeAncestorDepth", "50", "Max ancestors in context build"],
              ["treeContributionsPerNode", "500", "Max contributions per node in context"],
              ["treeNotesPerNode", "100", "Max notes per node in context"],
              ["treeMaxChildrenResolve", "200", "Max children resolved per node"],
              ["treeAllDataDepth", "20", "Max depth for getAllNodeData"],
              ["metadataNamespaceMaxBytes", "524288", "Per-namespace metadata cap in bytes"],
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
  <p style={{color: "rgba(255,255,255,0.55)", lineHeight: 1.8, marginBottom: 16, fontSize: "0.95rem", ...style}}>
    {children}
  </p>
);

const Code = ({ children, style }) => (
  <pre style={{
    background: "rgba(0,0,0,0.5)",
    border: "1px solid rgba(255,255,255,0.06)",
    borderRadius: 8,
    padding: "16px 20px",
    color: "rgba(255,255,255,0.6)",
    fontSize: "0.85rem",
    lineHeight: 1.6,
    overflowX: "auto",
    marginBottom: 16,
    ...style,
  }}>{children}</pre>
);

export default Guide;
