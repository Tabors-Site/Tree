import "./LandingPage.css";

const TreeOSPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "55vh"}}>
        <div className="lp-hero-inner">
          <h1 className="lp-title">TreeOS</h1>
          <p className="lp-subtitle">The first operating system built on the seed.</p>
          <p className="lp-tagline">
            The seed is the kernel. TreeOS is what we built on it to show what's possible.
            Four bundles, ninety-five extensions, and a handful of apps that turn trees into tools
            people actually use. The seed doesn't know about fitness or food or recovery.
            TreeOS does.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Guide</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Horizon</a>
          </div>
        </div>
      </section>

      {/* ── THE APPS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The Apps</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The tree structure IS the application. No separate database. No external API.
            You build the tree, the AI reads the tree, the tree does the work. Four apps ship
            with TreeOS. Each one is an extension. Each one proves the pattern.
          </p>

          <div className="lp-cards-2">
            <div className="lp-card">
              <h3>Fitness</h3>
              <p style={{fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.8}}>
                Three languages: gym (weight x reps x sets), running (distance x time x pace),
                bodyweight (reps x sets or duration). One LLM call detects modality and parses.
                Progressive overload tracked per modality. Type <code>be</code> at the Fitness tree
                and the coach walks you through today's program set by set.
              </p>
            </div>
            <div className="lp-card">
              <h3>Food</h3>
              <p style={{fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.8}}>
                Say what you ate. One LLM call parses macros. Cascade routes to Protein, Carbs, Fats nodes.
                Meals subtree tracks patterns by slot. History archives daily summaries with weekly averages.
                The food AI sees your workouts through channels. It knows what you need before you ask.
              </p>
            </div>
            <div className="lp-card">
              <h3>Recovery</h3>
              <p style={{fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.8}}>
                Track substances, feelings, cravings, and patterns. Taper schedules that bend around you.
                Pattern detection that finds correlations you can't see. A journal that holds without
                analyzing. Safety boundaries for dangerous withdrawals. The tree is a mirror, not a judge.
              </p>
            </div>
            <div className="lp-card">
              <h3><a href="/study" style={{color: "inherit", textDecoration: "none", borderBottom: "1px solid rgba(255,255,255,0.2)"}}>Study</a></h3>
              <p style={{fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.8}}>
                Queue what you want to learn. The AI breaks it into a curriculum, teaches through
                conversation, tracks mastery per concept, and detects gaps you can't see. Paste a URL
                and it reads the content for you. Type <code>be</code> and it picks the next lesson.
              </p>
            </div>
          </div>

          <div className="lp-card" style={{marginTop: 20, textAlign: "center", padding: "20px 28px"}}>
            <h3><code>be</code></h3>
            <p style={{fontSize: "0.9rem", color: "rgba(255,255,255,0.6)", lineHeight: 1.8, maxWidth: 600, margin: "0 auto"}}>
              One word. The tree takes over. You type <code>be</code> and the AI reads the structure,
              finds what needs doing, and guides you through it one step at a time. At a fitness tree:
              your workout. At a food tree: logging your meals. At a study tree: your next lesson.
              At any tree: a walkthrough of every branch and what's waiting.
            </p>
          </div>
        </div>
      </section>

      {/* ── THE SURFACE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The Surface</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every page is generated from the tree. Extensions like html-rendering and dashboard
            turn node data into web interfaces. No separate frontend framework. The tree IS the CMS.
            Share a link to a node and it renders. The AI and the human see the same structure.
          </p>

          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["Scheduler", "Plans tied to tree positions. The AI checks what's overdue. Notifications through any channel."],
              ["Dashboard", "Real-time view of the tree. Activity, cascade signals, extension status. WebSocket-driven."],
              ["Channels", "Node-to-node signal routing. Food talks to Fitness. Recovery talks to both. No imports between them."],
              ["Gateway", "Eleven channel types. Telegram, Discord, Slack, email, SMS, Reddit, X, Matrix, webhooks, tree-to-tree."],
              ["Values", "Numeric tracking on any node. Sets, reps, weight, macros, mood, streaks. Atomic increments."],
            ].map(([name, desc]) => (
              <div key={name} style={{
                display: "flex", gap: 12, padding: "12px 0",
                borderBottom: "1px solid rgba(255,255,255,0.05)",
              }}>
                <span style={{color: "#4ade80", minWidth: 100, fontSize: "0.85rem", fontWeight: 600}}>{name}</span>
                <span style={{color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", lineHeight: 1.7}}>{desc}</span>
              </div>
            ))}
          </div>

          <p style={{color: "rgba(255,255,255,0.4)", fontSize: "0.85rem", lineHeight: 1.8, marginTop: 24, textAlign: "center"}}>
            People can build extensions and share them. The market grows. Orchestrators that work get
            reused. Frontends get built on trees that already hold the data. A new infrastructure
            where the product is the structure, not the code around it.
          </p>
        </div>
      </section>

      {/* ── THE DEEPER LAYERS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The Deeper Layers</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Below the apps, TreeOS has a biological architecture. Four bundles. Three temporal layers.
            Three communication layers. The tree doesn't just store data. It thinks, breathes, and remembers.
          </p>

          <div className="lp-cards-2">
            <div className="lp-card">
              <h3 style={{color: "#f97316"}}>Cascade <span style={{fontSize: "0.75rem", color: "rgba(255,255,255,0.3)"}}>8 extensions</span></h3>
              <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.8}}>
                The nervous system. Signals propagate through the tree when content is written.
                Perspective filters decide what each node accepts. Codebooks compress shared language.
                Gap detection surfaces missing capabilities. Long memory persists relationships.
                Pulse monitors the health of the signal network.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#a78bfa"}}>Intelligence <span style={{fontSize: "0.75rem", color: "rgba(255,255,255,0.3)"}}>14 extensions</span></h3>
              <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.8}}>
                Self-awareness. The tree compresses its own knowledge. Detects contradictions between
                branches. Profiles users from behavior. Acts autonomously through intent. Searches
                semantically. Explores branches by sampling. Traces concepts through time. Notices when
                conversations go poorly. Proposes new extensions when users do things nothing handles.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#60a5fa"}}>Connect <span style={{fontSize: "0.75rem", color: "rgba(255,255,255,0.3)"}}>11 extensions</span></h3>
              <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.8}}>
                The rain. External channels become input sources. Discord messages become tree interactions.
                Emails become notes. Telegram chats become conversations at specific nodes. The clouds open.
                Every channel type registers five functions with the gateway core and gets the full
                dispatch pipeline for free.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#4ade80"}}>Maintenance <span style={{fontSize: "0.75rem", color: "rgba(255,255,255,0.3)"}}>5 extensions</span></h3>
              <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.8}}>
                Hygiene. Prune sheds dead branches, absorbing essence into the parent. Reroot
                reorganizes when structure no longer matches semantics. Changelog narrates what changed.
                Digest briefs the operator each morning. Delegate matches stuck work to available humans.
              </p>
            </div>
          </div>

          <h3 style={{textAlign: "center", marginTop: 32, marginBottom: 16, fontSize: "1.1rem"}}>Three Temporal Layers</h3>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              ["Phase", "seconds", "Detects awareness vs attention in conversation. The AI adjusts its approach in real time."],
              ["Breath", "minutes to hours", "Activity-driven metabolism. Fast when active. Slow when quiet. Stops when dormant. Extensions listen to exhale instead of running timers."],
              ["Rings", "months to years", "Growth, peak, hardening, dormancy. Each ring records who the tree was during that period. Annual compression. The tree remembers every age."],
            ].map(([name, scale, desc]) => (
              <div key={name} style={{padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.05)"}}>
                <div style={{display: "flex", gap: 12, alignItems: "baseline", marginBottom: 4}}>
                  <span style={{color: "#4ade80", fontSize: "0.9rem", fontWeight: 700}}>{name}</span>
                  <span style={{color: "rgba(255,255,255,0.3)", fontSize: "0.8rem"}}>{scale}</span>
                </div>
                <p style={{color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", lineHeight: 1.7, margin: 0}}>{desc}</p>
              </div>
            ))}
          </div>

          <h3 style={{textAlign: "center", marginTop: 32, marginBottom: 16, fontSize: "1.1rem"}}>Three Communication Layers</h3>
          <div style={{maxWidth: 600, margin: "0 auto"}}>
            {[
              [".flow", "The water table. Local to one land. Cascade results pool here. Trees pull what they need."],
              ["Canopy", "Trees reaching out. Direct land-to-land peering. Ed25519 signed requests. Intentional."],
              ["Mycelium", "The intelligent underground. Routes signals between lands that have never met. Reads extension lists, gap reports, evolution patterns. Delivers where the signal would be useful. The most connected node knows the most about the network."],
            ].map(([name, desc]) => (
              <div key={name} style={{padding: "14px 0", borderBottom: "1px solid rgba(255,255,255,0.05)"}}>
                <span style={{color: "#c084fc", fontSize: "0.9rem", fontWeight: 700}}>{name}</span>
                <p style={{color: "rgba(255,255,255,0.55)", fontSize: "0.85rem", lineHeight: 1.7, margin: "4px 0 0"}}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ── THE FUTURE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 700}}>
          <h2 className="lp-section-title">What Comes Next</h2>
          <p style={{color: "rgba(255,255,255,0.65)", lineHeight: 2, fontSize: "0.95rem"}}>
            I think the deeper features will take years to discover. Mycelium routing between lands
            that have never peered. Ring compression that captures a tree's character across decades.
            Autonomous intent acting on patterns no human noticed. These layers are built. They work.
            But they need density. They need many trees, many lands, many people growing things side by side
            before the network effects make them breathe.
          </p>
          <p style={{color: "rgba(255,255,255,0.65)", lineHeight: 2, fontSize: "0.95rem"}}>
            For a while, I think the adoption will be on the surface. Changing the way frontends on the
            internet work. Giving people smart AI tools that help them stay proficient. Fitness tracking
            that actually coaches. Food logging that actually advises. Recovery support that actually sees
            patterns. Study tools that actually adapt. The systematic nature of LLMs helping people live and
            follow their own goals. People building extensions. Markets expanding. People finally understanding
            the power of a persistent AI that lives in a structure it can read and write.
          </p>
          <p style={{color: "rgba(255,255,255,0.65)", lineHeight: 2, fontSize: "0.95rem"}}>
            As LLMs get stronger and more people build, I think the deeper layers will start to come alive.
            Trees will pick up life slowly. Cascade signals will flow between lands through mycelium.
            Rings will form from years of activity. The forest will grow. Not because someone planned every
            tree. Because the seed was planted and the structure was right.
          </p>
          <p style={{color: "rgba(255,255,255,0.35)", lineHeight: 2, fontSize: "0.85rem", marginTop: 24}}>
            The apple is the tree.
          </p>
        </div>
      </section>

      {/* ── FOOTER ── */}
      <section className="lp-section" style={{paddingBottom: 60}}>
        <div className="lp-container" style={{textAlign: "center"}}>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="/land">Start a Land</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Guide</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Horizon</a>
          </div>
        </div>
      </section>

    </div>
  );
};

export default TreeOSPage;
