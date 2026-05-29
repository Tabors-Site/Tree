import { useEffect, useRef } from "react";
import "./LandingPage.css";

function useParticles(canvasRef) {
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    let animId;
    let particles = [];
    const COUNT = 60;

    function resize() {
      canvas.width = canvas.parentElement.offsetWidth;
      canvas.height = canvas.parentElement.offsetHeight;
    }
    resize();
    window.addEventListener("resize", resize);

    for (let i = 0; i < COUNT; i++) {
      const isOrange = i >= COUNT - Math.floor(COUNT * 0.2);
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        r: isOrange ? Math.random() * 1.2 + 0.3 : Math.random() * 1.8 + 0.4,
        dx: (Math.random() - 0.5) * (isOrange ? 0.15 : 0.3),
        dy: (Math.random() - 0.5) * (isOrange ? 0.15 : 0.3),
        opacity: isOrange ? Math.random() * 0.35 + 0.1 : Math.random() * 0.5 + 0.2,
        pulse: Math.random() * Math.PI * 2,
        color: isOrange ? [249, 115, 22] : [200, 180, 255],
        glow: isOrange ? [249, 140, 60] : [180, 160, 255],
      });
    }

    function draw() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      // Fade based on scroll
      const scrollFade = Math.max(0, 1 - window.scrollY / (canvas.height * 0.8));

      for (const p of particles) {
        p.x += p.dx;
        p.y += p.dy;
        p.pulse += 0.01;

        // Wrap around
        if (p.x < -5) p.x = canvas.width + 5;
        if (p.x > canvas.width + 5) p.x = -5;
        if (p.y < -5) p.y = canvas.height + 5;
        if (p.y > canvas.height + 5) p.y = -5;

        const flicker = 0.7 + Math.sin(p.pulse) * 0.3;
        const alpha = p.opacity * flicker * scrollFade;
        if (alpha < 0.01) continue;

        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        const [cr, cg, cb] = p.color;
        ctx.fillStyle = `rgba(${cr}, ${cg}, ${cb}, ${alpha})`;
        ctx.fill();

        // Glow
        if (p.r > 0.8) {
          const [gr, gg, gb] = p.glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.r * 3, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(${gr}, ${gg}, ${gb}, ${alpha * 0.15})`;
          ctx.fill();
        }
      }

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", resize);
    };
  }, [canvasRef]);
}

const LandingPage = () => {
  const particleRef = useRef(null);
  useParticles(particleRef);

  return (
    <div className="lp">

      {/* ── BANNER ── */}
      <div className="lp-banner">
        TreeOS is live. <a href="/guide" style={{color: "rgba(255,255,255,0.7)", textDecoration: "none", borderBottom: "1px solid rgba(255,255,255,0.2)"}}>Read the guide</a>.
      </div>

      {/* ── HERO ── */}
      <section className="lp-hero">
        <canvas ref={particleRef} className="lp-particles" />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🌱</div>
          <h1 className="lp-title">The Seed</h1>
          <p className="lp-subtitle">An Open Kernel for AI Agents</p>
          <p className="lp-tagline">
            The minimum kernel an AI agent needs to live somewhere persistent, think at every
            position, communicate through signals, and grow through extensions. Plant the seed.
            Build anything on top of it.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="/start">Start</a>
            <a className="lp-btn lp-btn-secondary" href="/use">See what it's like</a>
            <a className="lp-btn lp-btn-secondary" href="/kernel">Inside the Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ibp">IBP</a>
            <a className="lp-btn lp-btn-secondary" href="/treeos">TreeOS</a>
          </div>
        </div>
      </section>

      {/* ── QUOTE ── */}
      <section className="lp-quote-section">
        <blockquote className="lp-quote">
          "This is what makes TreeOS different from every other system. The user isn't configuring an app. They're growing one."
        </blockquote>
        <cite className="lp-quote-author">SAM</cite>
      </section>

      {/* ── WHAT IT FEELS LIKE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 700, textAlign: "center"}}>
          <h2 className="lp-section-title">One Tree. Your Whole Life.</h2>
          <p className="lp-section-sub" style={{fontSize: "1.05rem", lineHeight: 1.8, color: "rgba(255,255,255,0.6)"}}>
            You talk to it. It understands. "I ate eggs for breakfast" goes to your nutrition tracker.
            "Bench 225 for 5" goes to your workout log. "I'm tired of studying" goes to your recovery journal.
            You don't pick the app. You just say what happened. The tree knows where it goes because
            you're standing in your life, not in someone else's interface.
          </p>
          <p className="lp-section-sub" style={{fontSize: "0.9rem", lineHeight: 1.8, color: "rgba(255,255,255,0.35)", marginTop: 8}}>
            Extensions add capabilities. Fitness tracks progressive overload. Food parses macros.
            Study builds curricula. KB stores knowledge. Each one is an app that lives in the tree.
            Install what you need. Remove what you don't. The kernel doesn't care.
          </p>
          <div style={{marginTop: 24}}>
            <a className="lp-btn lp-btn-secondary" href="/use">See what it's like</a>
          </div>
        </div>
      </section>

      {/* ── FOUR LAYERS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Four Layers</h2>
          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card" style={{display: "flex", flexDirection: "column"}}>
              <h3 style={{color: "#f97316"}}>The Seed</h3>
              <p style={{flex: 1}}>
                Two schemas. 30 lifecycle hooks. Five registries. A cascade engine.
                A response protocol. The contract that never changes.
              </p>
              <div style={{textAlign: "center", marginTop: 16}}>
                <a href="/kernel" style={{color: "#f97316", fontSize: "0.9rem", fontWeight: 600, textDecoration: "none", borderBottom: "1px solid rgba(249, 115, 22, 0.3)", paddingBottom: 2}}>Inside the seed</a>
              </div>
            </div>
            <div className="lp-card" style={{display: "flex", flexDirection: "column"}}>
              <h3 style={{color: "#a78bfa"}}>Extensions</h3>
              <p style={{flex: 1}}>
                Twenty base extensions ship with every land. Four bundles add depth:
                Cascade (8, the nervous system). Intelligence (14, self-awareness).
                Connect (11, external channels). Maintenance (5, hygiene). 114 extensions total.
              </p>
              <div style={{textAlign: "center", marginTop: 16}}>
                <a href="/extensions" style={{color: "#a78bfa", fontSize: "0.9rem", fontWeight: 600, textDecoration: "none", borderBottom: "1px solid rgba(167, 139, 250, 0.3)", paddingBottom: 2}}>How extensions work</a>
              </div>
            </div>
            <div className="lp-card" style={{display: "flex", flexDirection: "column"}}>
              <h3 style={{color: "#4ade80"}}>Federation</h3>
              <p style={{flex: 1}}>
                Lands peer directly through signed requests. Three communication layers:
                .flow (water table), Canopy (direct peering), Mycelium (intelligent routing).
              </p>
              <div style={{textAlign: "center", marginTop: 16}}>
                <a href="/network" style={{color: "#4ade80", fontSize: "0.9rem", fontWeight: 600, textDecoration: "none", borderBottom: "1px solid rgba(74, 222, 128, 0.3)", paddingBottom: 2}}>The network</a>
              </div>
            </div>
            <div className="lp-card" style={{display: "flex", flexDirection: "column"}}>
              <h3 style={{color: "#38bdf8"}}>Ecosystem</h3>
              <p style={{flex: 1}}>
                The tree knows itself. It compresses, detects contradictions, profiles users,
                evolves structural patterns, searches semantically, explores branches, and holds
                its own purpose. Every extension reads from every other. The whole is alive.
              </p>
              <div style={{textAlign: "center", marginTop: 16}}>
                <a href="/ai" style={{color: "#38bdf8", fontSize: "0.9rem", fontWeight: 600, textDecoration: "none", borderBottom: "1px solid rgba(56, 189, 248, 0.3)", paddingBottom: 2}}>How the AI thinks</a>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── DEEP DIVES ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Go Deeper</h2>
          <p className="lp-section-sub">Twelve pages. Each one answers one question.</p>
          <div className="lp-cards-3" style={{gridTemplateColumns: "repeat(4, 1fr)"}}>
            {[
              { href: "/seed", title: "The Seed", desc: "What is the contract?" },
              { href: "/ai", title: "The AI", desc: "How does the tree think?" },
              { href: "/cascade", title: "Cascade", desc: "How does it communicate?" },
              { href: "/flow", title: "The Flow", desc: "How does data move?" },
              { href: "/extensions", title: "Extensions", desc: "How does the tree grow?" },
              { href: "/network", title: "The Network", desc: "How do trees connect?" },
              { href: "/mycelium", title: "Mycelium", desc: "The forest underground." },
              { href: "/use", title: "Use TreeOS", desc: "One life, one tree." },
              { href: "/what", title: "What Is TreeOS?", desc: "Apps + filesystem." },
              { href: "/html", title: "HTML System", desc: "Three interfaces, one tree." },
              { href: "/start", title: "Get Started", desc: "Join or run your own." },
              { href: "/guide", title: "The Guide", desc: "Everything in one place." },
            ].map(({ href, title, desc }) => (
              <a key={href} href={href} className="lp-card" style={{textDecoration: "none", textAlign: "center", padding: 20}}>
                <h3 style={{fontSize: "0.95rem", marginBottom: 4}}>{title}</h3>
                <p style={{fontSize: "0.78rem"}}>{desc}</p>
              </a>
            ))}
          </div>
        </div>
      </section>

      {/* ── CLI ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title"><a href="/cli" style={{color: "inherit", textDecoration: "none"}}>Terminal Native</a></h2>
          <p className="lp-section-sub">
            The CLI works like a regular terminal. <code>cd</code>, <code>ls</code>,
            <code>mkdir</code>, <code>rm</code>, <code>mv</code>. If you know a shell,
            you know TreeOS.
          </p>
          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Goals</span> <span className="lp-term-caret">› </span>ls</div>
              <div className="lp-term-line lp-term-output">  Fitness  ·  Career  ·  Reading  ·  Side Projects</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Goals</span> <span className="lp-term-caret">› </span>cd Fitness</div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Goals/Fitness</span> <span className="lp-term-caret">› </span>tree</div>
              <div className="lp-term-line lp-term-output lp-term-green">  Fitness</div>
              <div className="lp-term-line lp-term-output lp-term-green">  ├─ Chest Day</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  ├─ Leg Day  (completed)</div>
              <div className="lp-term-line lp-term-output lp-term-green">  └─ Cardio</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Goals/Fitness</span> <span className="lp-term-caret">› </span>add a back and biceps routine</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Created: Back and Biceps</div>
              <div className="lp-term-line lp-term-output">    Pull-ups 4x8, Rows 3x10, Curls 3x12</div>
            </div>
          </div>
          <div className="lp-cli-features">
            <div className="lp-cli-feat"><strong>Navigate</strong> cd, ls, pwd, tree</div>
            <div className="lp-cli-feat"><strong>Build</strong> mkdir, rm, mv, rename, type</div>
            <div className="lp-cli-feat"><strong>Content</strong> note, notes, value, goal</div>
            <div className="lp-cli-feat"><strong>AI</strong> just talk, @sessions</div>
            <div className="lp-cli-feat"><strong>Cascade</strong> cascade, perspective, codebook, flow, water</div>
            <div className="lp-cli-feat"><strong>Intelligence</strong> compress, contradictions, inverse, evolution, intent</div>
            <div className="lp-cli-feat"><strong>Extensions</strong> ext install, ext-allow, ext-scope</div>
            <div className="lp-cli-feat"><strong>Gateway</strong> gateway add, gateway test</div>
            <div className="lp-cli-feat"><strong>LLM</strong> llm add, llm assign</div>
          </div>
          <div style={{textAlign: "center", marginTop: 32}}>
            <a className="lp-btn lp-btn-secondary" href="/cli">Learn more</a>
          </div>
        </div>
      </section>

      {/* ── THREE ZONES ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Three Zones</h2>
          <p className="lp-section-sub">
            Where you are determines what the AI can do. Navigate to change context.
            No mode switching. Just <code>cd</code>.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Land <code>/</code></h3>
              <p>
                The root. Manage extensions, configuration, users, peers.
                The AI becomes a land operator. It can install packages,
                read system nodes, run diagnostics, and manage federation.
                Admin access required.
              </p>
            </div>
            <div className="lp-card">
              <h3>Home <code>~</code></h3>
              <p>
                Your personal space. Raw ideas, your notes across all trees,
                your chat history, your contributions. The AI helps you
                organize and reflect on your work across the whole land.
              </p>
            </div>
            <div className="lp-card">
              <h3>Tree <code>/MyTree</code></h3>
              <p>
                Inside a tree. The AI reads the branch, classifies your intent,
                and acts. <strong>Chat</strong> reads and writes.
                <strong> Place</strong> adds content silently.
                <strong> Query</strong> reads only, changes nothing.
                Extensions like fitness and food add their own commands and
                AI behavior that activate on the branches where they're allowed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Get Running</h2>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num">1</div>
              <div className="lp-step-content">
                <h4>Start a Land</h4>
                <p>Your server. Stores trees, runs AI, serves the API. First boot walks you through config and extension selection.</p>
                <code>treeos land</code>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">2</div>
              <div className="lp-step-content">
                <h4>Connect</h4>
                <p>Point the CLI at any land. Register. Connect your own LLM or use the tree owner's model.</p>
                <code>treeos connect http://localhost:3000</code>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">3</div>
              <div className="lp-step-content">
                <h4>Plant a Tree</h4>
                <p>Name it. Type it. Navigate with cd and ls. Build branches with mkdir. Add notes (text or files).</p>
                <code>treeos mkroot "Fitness" --type goal</code>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num">4</div>
              <div className="lp-step-content">
                <h4>Use It</h4>
                <p>Chat creates and edits. Place adds content where it belongs. Query reads without changing anything. You and AI work the same tree.</p>
                <code>treeos chat "break this into weekly tasks"</code>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── EXTENSIONS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Extensions</h2>
          <p className="lp-section-sub">
            npm let developers stop rewriting the same JavaScript functions. TreeOS does
            the same thing for agent orchestration. Instead of sharing code that humans run,
            you share capabilities that agents run, on a persistent structure that agents inhabit.
          </p>

          <p className="lp-section-sub" style={{maxWidth: 700, fontSize: "0.9rem", color: "rgba(255,255,255,0.45)", marginTop: -8}}>
            Extensions ship as bundles. Install a bundle and everything it needs comes with it.
            Remove one and the rest keep working. The kernel never knows they exist.
          </p>

          {/* ── FOUR BUNDLES ── */}

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card" style={{borderLeft: "3px solid rgba(249, 115, 22, 0.5)"}}>
              <h3 style={{color: "#f97316", fontSize: "1rem"}}>treeos-cascade</h3>
              <p style={{fontSize: "0.85rem", color: "#888", marginBottom: 8}}>
                The nervous system. 8 extensions. One kernel hook becomes a full signal network:
                propagation, perspective filtering, sealed transport, long memory, codebook compression,
                gap detection, pulse health, flow visualization.
              </p>
              <code style={{fontSize: "0.75rem", color: "rgba(255,255,255,0.3)"}}>treeos ext install treeos-cascade</code>
            </div>
            <div className="lp-card" style={{borderLeft: "3px solid rgba(56, 189, 248, 0.5)"}}>
              <h3 style={{color: "#38bdf8", fontSize: "1rem"}}>treeos-intelligence</h3>
              <p style={{fontSize: "0.85rem", color: "#888", marginBottom: 8}}>
                Self-awareness. 14 extensions. The tree compresses knowledge, detects contradictions, profiles users,
                tracks structural fitness, acts autonomously, searches semantically, explores branches, traces threads,
                maps boundaries, tracks competence edges, notices conversational shifts, proposes new extensions, remembers every age.
              </p>
              <code style={{fontSize: "0.75rem", color: "rgba(255,255,255,0.3)"}}>treeos ext install treeos-intelligence</code>
            </div>
            <div className="lp-card" style={{borderLeft: "3px solid rgba(74, 222, 128, 0.5)"}}>
              <h3 style={{color: "#4ade80", fontSize: "1rem"}}>treeos-connect</h3>
              <p style={{fontSize: "0.85rem", color: "#888", marginBottom: 8}}>
                External channels. 11 extensions. Gateway core with type registry plus telegram, discord,
                webhook, email, sms, slack, matrix, reddit, X, tree-to-tree. Each channel registers and gets the full pipeline.
              </p>
              <code style={{fontSize: "0.75rem", color: "rgba(255,255,255,0.3)"}}>treeos ext install treeos-connect</code>
            </div>
            <div className="lp-card" style={{borderLeft: "3px solid rgba(167, 139, 250, 0.5)"}}>
              <h3 style={{color: "#a78bfa", fontSize: "1rem"}}>treeos-maintenance</h3>
              <p style={{fontSize: "0.85rem", color: "#888", marginBottom: 8}}>
                Hygiene. 5 extensions. Prune dead branches. Reroot misplaced nodes by semantic similarity.
                Changelog tracks what changed. Digest briefs the operator each morning.
                Delegate matches stuck work to available humans.
              </p>
              <code style={{fontSize: "0.75rem", color: "rgba(255,255,255,0.3)"}}>treeos ext install treeos-maintenance</code>
            </div>
          </div>

          <p className="lp-section-sub" style={{marginTop: 32, marginBottom: 16, color: "rgba(255,255,255,0.5)", fontSize: "0.9rem"}}>
            Plus standalone extensions and the base TreeOS system:
          </p>

          <div style={{maxWidth: 700, margin: "0 auto", fontSize: "0.85rem", lineHeight: 1.8}}>
            {[
              ["mycelium", "Intelligent cross-land signal routing. The forest underground."],
              ["understanding", "Bottom-up tree compression. Walks leaves to root, summarizes upward."],
              ["dreams", "Background maintenance. Runs while you sleep. Reorganizes, expands, notifies."],
              ["perspective-filter", "Per-node cascade filtering by topic. Each node declares what it drinks."],
              ["land-manager", "AI land management. Extensions, config, users, peers from the root."],
              ["html-rendering", "Server-rendered pages. Values, schedules, gateway, prestige all get web views."],
              ["gateway-telegram", "Telegram bot. Input, output, or both. Webhook receiver."],
              ["gateway-discord", "Discord bot. Persistent WebSocket. Channel pooling by token."],
              ["shell", "Execute server commands from the AI. Confined scope."],
              ["scripts", "Sandboxed JavaScript on nodes. Confined scope."],
              ["solana", "On-chain wallets per tree. Confined scope."],
              ["fitness", "Workout coaching and tracking with progressive overload."],
              ["food", "Calorie and macro tracking from natural language."],
              ["values", "Numeric values and goals on nodes with tree-wide accumulation."],
              ["backup", "Full and snapshot backup/restore. Point-in-time recovery."],
              ["prestige", "Node versioning. Compare, revert, branch from any version."],
              ["energy", "Usage metering. Token tracking per user per action."],
              ["billing", "Stripe subscriptions. Tier-gated features."],
              ["raw-ideas", "Capture and auto-place. The AI sorts your loose thoughts."],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", gap: 12, padding: "6px 0",
                borderBottom: "1px solid rgba(255,255,255,0.03)",
              }}>
                <code style={{color: "#4ade80", minWidth: 160, fontSize: "0.8rem"}}>{name}</code>
                <span style={{color: "rgba(255,255,255,0.45)"}}>{desc}</span>
              </div>
            ))}
            <p style={{color: "rgba(255,255,255,0.3)", marginTop: 12, fontSize: "0.8rem"}}>
              And 50+ more: blog, book, schedules, transactions, llm-failover, user-queries, api-keys, email,
              deleted-revive, dashboard, navigation, team, notifications, console, monitor, persona, channels,
              governance, peer-review, seed-export, teach, split, and every gateway channel (reddit, slack,
              sms, matrix, x, tree).
            </p>
          </div>

          <div className="lp-ext-cta" style={{marginTop: 24}}>
            <a href="/extensions">How extensions work</a>
            <span style={{color: "rgba(255,255,255,0.15)", margin: "0 12px"}}>.</span>
            <a href="https://horizon.treeos.ai">Browse all at horizon.treeos.ai</a>
          </div>
        </div>
      </section>

      {/* ── SPATIAL SCOPING EXAMPLE ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Position Is Everything</h2>
          <p className="lp-section-sub">
            Navigate somewhere and the world changes. Each branch controls which
            extensions are active. Block an extension and it disappears for that
            entire subtree. Restrict it to read-only and it can observe but not modify.
          </p>

          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">treeos</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line lp-term-output lp-term-dim">  # A Life tree with Health and Finance branches</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Life/Health</span> <span className="lp-term-caret">› </span>cd Fitness</div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Life/Health/Fitness</span> <span className="lp-term-caret">› </span>ext-restrict food read</div>
              <div className="lp-term-line lp-term-output lp-term-green">  Restricted food to read at this node.</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Its write tools are filtered. Read tools and hooks still work.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Life/Health/Fitness</span> <span className="lp-term-caret">› </span>bench 135x10x10x8</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Got it. Bench: 135x10/10/8. Logged.</div>
              <div className="lp-term-line lp-term-output">  Up from 130 last session. Nice progression.</div>
              <div className="lp-term-line lp-term-output">  Next up: Overhead Press.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output lp-term-dim">  # Allow a confined extension at a specific branch</div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Life/Health/Fitness</span> <span className="lp-term-caret">› </span>cd /Life/Finance</div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Life/Finance</span> <span className="lp-term-caret">› </span>ext-allow solana</div>
              <div className="lp-term-line lp-term-output lp-term-green">  Allowed: solana</div>
              <div className="lp-term-line lp-term-output lp-term-dim">  Confined extension activated at this position and all children.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Life/Finance</span> <span className="lp-term-caret">› </span>cd /Life/Health/Food</div>
              <div className="lp-term-line"><span className="lp-term-prompt">tabor@treeos.ai</span><span className="lp-term-path">/Life/Health/Food</span> <span className="lp-term-caret">› </span>i had eggs and toast for breakfast</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Logged. Eggs (2): 144 cal, 12g protein. Toast: 80 cal, 3g protein.</div>
              <div className="lp-term-line lp-term-output">  Today so far: 224 / 2,000 cal. 15g protein. You've got room.</div>
            </div>
          </div>

          <p style={{ textAlign: "center", color: "rgba(255,255,255,0.5)", fontSize: "0.85rem", marginTop: 20 }}>
            The fitness coach can reference your nutrition data (it's read-only there).
            The food coach can't create workout nodes. Each branch controls its own capabilities.
            Same extensions, different access, based on where you are.
          </p>

          <div style={{maxWidth: 640, margin: "32px auto 0", padding: "20px 24px", background: "rgba(74, 222, 128, 0.04)", border: "1px solid rgba(74, 222, 128, 0.1)", borderRadius: 8}}>
            <p style={{color: "rgba(255,255,255,0.7)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
              <strong style={{color: "#4ade80"}}>The help menu is position-aware.</strong> Run <code>help</code> at
              /Health/Fitness and you see fitness commands. Navigate to /Finance and the help menu
              changes. Shell commands disappear where shell is blocked. Solana commands only appear
              where solana is allowed. The CLI shows exactly what the AI can do at your position.
              The same commands the AI sees. The same tools it has access to. Your help menu is your
              capability surface.
            </p>
          </div>

          <div style={{maxWidth: 640, margin: "16px auto 0", padding: "20px 24px", background: "rgba(192, 132, 252, 0.04)", border: "1px solid rgba(192, 132, 252, 0.1)", borderRadius: 8}}>
            <p style={{color: "rgba(255,255,255,0.7)", fontSize: "0.9rem", lineHeight: 1.7, margin: 0}}>
              <strong style={{color: "#c084fc"}}>Two scoping modes.</strong> Global extensions are active
              everywhere until you block them. Confined extensions are active nowhere until you allow them.
              Codebook and evolution are global. You want them everywhere. Shell and solana are confined.
              You want them only where they belong. <code>ext-allow solana</code> at /Finance. It exists
              there and nowhere else.
            </p>
          </div>
        </div>
      </section>

      {/* ── FOR DIFFERENT AUDIENCES ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Who Is This For?</h2>
          <div className="lp-cards-3">
            <div className="lp-card">
              <h3>Developers</h3>
              <p>
                A modular runtime for persistent AI agents with a federated extension
                system. The kernel manages tree-structured data and an MCP-based AI loop.
                Extensions register their own tools, routes, models, and jobs.
              </p>
            </div>
            <div className="lp-card">
              <h3>AI Builders</h3>
              <p>
                Every orchestration pattern you build dies in your repo.
                TreeOS makes orchestration composable and shareable. Package your
                memory system, your reasoning chain, your tool pipeline as an extension.
                Publish it. Now every agent on the network can use it.
              </p>
            </div>
            <div className="lp-card">
              <h3>Everyone Else</h3>
              <p>
                The internet was built for documents.
                AI agents need persistent structure, memory, tools, and the ability
                to interact with other agents. TreeOS is what the internet
                might look like if it were designed for agents from the start.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── THREE COMMUNICATION LAYERS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The Network</h2>
          <p className="lp-section-sub">
            Every real forest has three communication layers. Now every TreeOS network does too.
          </p>
          <div className="lp-cards-3">
            <div className="lp-card" style={{borderTop: "2px solid rgba(56, 189, 248, 0.4)"}}>
              <h3 style={{color: "#38bdf8"}}>.flow</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The water table. Local to one land. Ambient. Cascade signals pool and trees pull
                what they need. No intelligence. No routing. Already built into the kernel.
              </p>
            </div>
            <div className="lp-card" style={{borderTop: "2px solid rgba(74, 222, 128, 0.4)"}}>
              <h3 style={{color: "#4ade80"}}>Canopy</h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                Trees reaching out. Direct land-to-land peering. Ed25519 signed requests.
                Heartbeat every 5 minutes. Cross-land cascade, invites, LLM proxy, tree sharing.
              </p>
            </div>
            <div className="lp-card" style={{borderTop: "2px solid rgba(192, 132, 252, 0.4)"}}>
              <h3 style={{color: "#c084fc"}}><a href="/mycelium" style={{color: "inherit", textDecoration: "none"}}>Mycelium</a></h3>
              <p style={{fontSize: "0.85rem", color: "#888"}}>
                The intelligent underground. An extension any land installs to become a routing node.
                Reads signal metadata and peer profiles. Routes where signals would be useful.
                The most connected node knows the most about the network.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── POSITIONING ── */}
      <section className="lp-section">
        <div className="lp-container">
          <div className="lp-positioning">
            <div className="lp-pos-item">
              <h4>"Why not just use ChatGPT?"</h4>
              <p>
                Those are products where you visit an AI in someone else's house.
                TreeOS is infrastructure where the AI lives in yours. The agent persists.
                It accumulates context. It gains capabilities through extensions you choose.
                It federates through an open protocol. It is not a chat product. It is the
                layer beneath chat products.
              </p>
            </div>
            <div className="lp-pos-item">
              <h4>"Why not just self-host a model?"</h4>
              <p>
                A model is a brain with no body. TreeOS is the body. The persistent structure,
                the memory, the tools, the network. It is model-agnostic. The kernel runs an AI
                conversation loop via MCP. What model powers it is your choice on your land.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── INSTALL CTA ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Get Started</h2>
          <p className="lp-section-sub">One command. Interactive setup walks you through the rest.</p>
          <div className="lp-terminal">
            <div className="lp-term-header">
              <span className="lp-term-dot red"></span>
              <span className="lp-term-dot yellow"></span>
              <span className="lp-term-dot green"></span>
              <span className="lp-term-title">Terminal</span>
            </div>
            <div className="lp-term-body">
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> npx create-treeos my-land</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> cd my-land</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> npm start</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Welcome to TreeOS.</div>
              <div className="lp-term-line lp-term-output" style={{color: "rgba(255,255,255,0.5)"}}>  First-run setup. Answer a few questions to configure your Land.</div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-output">  Domain (localhost): <span style={{color: "#27c93f"}}>mysite.com</span></div>
              <div className="lp-term-line lp-term-output">  Land name (My Land): <span style={{color: "#27c93f"}}>Research Lab</span></div>
              <div className="lp-term-line lp-term-output">  Port (3000): </div>
              <div className="lp-term-line lp-term-output"></div>
              <div className="lp-term-line lp-term-comment"># Or connect to an existing land</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> treeos connect https://treeos.ai</div>
              <div className="lp-term-line"><span className="lp-term-prompt">$</span> treeos register</div>
            </div>
          </div>
        </div>
      </section>

      {/* ── FROM TABOR ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 720}}>
          <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.9, fontSize: "0.95rem", marginBottom: 20}}>
            If you build code, play with agents, or use LLMs, I need your help. Not from a
            corporation. From you. The everyday person who builds things because they care
            about what they are building.
          </p>
          <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.9, fontSize: "0.95rem", marginBottom: 20}}>
            I built a new kernel specifically for AI. It already has extensions but the more
            contributors the faster it grows. The extensions become operating systems built on top
            of it. Anyone can build extensions and operating systems as people build off the kernel,
            specifically designed to compound and organize AI intelligence.
          </p>
          <p style={{color: "rgba(255,255,255,0.6)", lineHeight: 1.9, fontSize: "0.95rem", marginBottom: 20}}>
            Host your server and you are automatically in a decentralized network. If you do not want
            to host, you can join someone else's land. Once in, download extensions others have made
            to get a conceptual understanding since this is quite new. I think you will quickly see
            how the benefits compound for all of us who contribute. Complex orchestration systems
            will no longer be hard to access or share. We all build together.
          </p>
          <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem", textAlign: "right"}}>
            Tabor
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
              <a href="/code">Code</a>
              <a href="/cascade">Cascade</a>
              <a href="/governing">Governing</a>
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
              <a href="/treeos">Overview</a>
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
              <a href="https://github.com/taborgreat/create-treeos/blob/main/template/seed/LICENSE">AGPL-3.0 License</a>
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

export default LandingPage;
