import "./LandingPage.css";
import Particles from "./Particles.jsx";

const TreeOSPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero" style={{minHeight: "55vh"}}>
        <Particles count={25} />
        <div className="lp-hero-inner">
          <h1 className="lp-title">TreeOS</h1>
          <p className="lp-subtitle">The first operating system built on the seed.</p>
          <p className="lp-tagline">
            The seed is the kernel. TreeOS is the extensions we built on it. Free. Open source.
            Published to Horizon for anyone to install. The seed doesn't know about fitness or food
            or recovery. TreeOS does.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-primary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/what">What?</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Guide</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Horizon</a>
            <a className="lp-btn lp-btn-secondary" href="/cli">CLI</a>
            <a className="lp-btn lp-btn-secondary" href="/html">HTML</a>
          </div>
        </div>
      </section>

      {/* ── THREE THINGS ── */}
      <section className="lp-section" style={{paddingTop: 60, paddingBottom: 40}}>
        <div className="lp-container" style={{maxWidth: 760}}>
          <div style={{display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 20}}>
            <div style={{padding: "20px", borderRadius: 12, background: "rgba(72,187,120,0.08)", border: "1px solid rgba(72,187,120,0.15)"}}>
              <h3 style={{color: "#4ade80", fontSize: "1rem", margin: "0 0 8px"}}>The Seed</h3>
              <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.85rem", lineHeight: 1.7, margin: 0}}>
                The kernel. AGPL-3.0. Two schemas, conversation loop, hooks, cascade, extension loader.
                Never changes. You can build anything on it. The license protects the kernel.
              </p>
            </div>
            <div style={{padding: "20px", borderRadius: 12, background: "rgba(102,126,234,0.08)", border: "1px solid rgba(102,126,234,0.15)"}}>
              <h3 style={{color: "#667eea", fontSize: "1rem", margin: "0 0 8px"}}>TreeOS</h3>
              <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.85rem", lineHeight: 1.7, margin: 0}}>
                The extensions. Free. Published on Horizon. Four bundles, twenty-one base, eight standalone, five apps.
                Install what you want. Remove what you don't. Fork and build your own OS.
              </p>
            </div>
            <div style={{padding: "20px", borderRadius: 12, background: "rgba(159,122,234,0.08)", border: "1px solid rgba(159,122,234,0.15)"}}>
              <h3 style={{color: "#9f7aea", fontSize: "1rem", margin: "0 0 8px"}}>treeos.ai</h3>
              <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.85rem", lineHeight: 1.7, margin: 0}}>
                Our land. One running server. Where we experiment, build, and test.
                The <a href="/app" style={{color: "rgba(159,122,234,0.8)"}}>site</a> is our land's frontend.
                TreeOS the package is what we publish from it for everyone.
              </p>
            </div>
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

          <div style={{display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 20, maxWidth: 700, margin: "0 auto"}}>
            {[
              {
                emoji: "💪", name: "Fitness", href: "/fitness",
                color: "rgba(102, 126, 234, 0.12)", border: "rgba(102, 126, 234, 0.25)", accent: "#667eea",
                desc: "Three languages: gym (weight x reps x sets), running (distance x time x pace), bodyweight (reps x sets or duration). One LLM call detects modality and parses. Progressive overload tracked per modality. Type be at the Fitness tree and the coach walks you through today's program set by set.",
              },
              {
                emoji: "🍎", name: "Food", href: "/food",
                color: "rgba(72, 187, 120, 0.12)", border: "rgba(72, 187, 120, 0.25)", accent: "#48bb78",
                desc: "Say what you ate. One LLM call parses macros. Cascade routes to Protein, Carbs, Fats nodes. Meals subtree tracks patterns by slot. History archives daily summaries with weekly averages. The food AI sees your workouts through channels. It knows what you need before you ask.",
              },
              {
                emoji: "🌿", name: "Recovery", href: "/recovery",
                color: "rgba(236, 201, 75, 0.12)", border: "rgba(236, 201, 75, 0.25)", accent: "#ecc94b",
                desc: "Track substances, feelings, cravings, and patterns. Taper schedules that bend around you. Pattern detection that finds correlations you can't see. A journal that holds without analyzing. Safety boundaries for dangerous withdrawals. The tree is a mirror, not a judge.",
              },
              {
                emoji: "📚", name: "Study", href: "/study",
                color: "rgba(159, 122, 234, 0.12)", border: "rgba(159, 122, 234, 0.25)", accent: "#9f7aea",
                desc: "Queue what you want to learn. The AI breaks it into a curriculum, teaches through conversation, tracks mastery per concept, and detects gaps you can't see. Paste a URL and it reads the content for you. Type be and it picks the next lesson.",
              },
              {
                emoji: "📖", name: "KB", href: "/kb",
                color: "rgba(96, 165, 250, 0.12)", border: "rgba(96, 165, 250, 0.25)", accent: "#60a5fa",
                desc: "Tell it things. Ask it things. One person maintains, everyone benefits. The tree organizes knowledge into a hierarchy. The AI answers from stored notes with citations. Staleness detection flags what's getting old. The coworker who never forgets.",
              },
            ].map(app => (
              <a key={app.name} href={app.href} style={{
                display: "block", textDecoration: "none",
                background: app.color, border: `1px solid ${app.border}`,
                borderRadius: 16, padding: "24px 24px 20px",
                transition: "transform 0.2s, background 0.2s",
              }}
                onMouseEnter={e => { e.currentTarget.style.transform = "translateY(-2px)"; }}
                onMouseLeave={e => { e.currentTarget.style.transform = "translateY(0)"; }}
              >
                <div style={{fontSize: "1.8rem", marginBottom: 8}}>{app.emoji}</div>
                <h3 style={{color: app.accent, fontSize: "1.15rem", margin: "0 0 8px", fontWeight: 700}}>{app.name}</h3>
                <p style={{fontSize: "0.85rem", color: "rgba(255,255,255,0.55)", lineHeight: 1.75, margin: 0}}>
                  {app.desc}
                </p>
              </a>
            ))}
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

      {/* ── HOW INTENT IS CHANNELED ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">How Intent Is Channeled</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The tree has a grammar. You speak naturally. The system parses.
          </p>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr"}}>
            <div className="lp-card">
              <h3 style={{color: "#a78bfa"}}>Nodes are nouns</h3>
              <p>
                Bench Press. Protein. Chapter 3. They are things with identity,
                position, and relationships. They sit in the tree and hold meaning.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#4ade80"}}>Extensions are verbs</h3>
              <p>
                Food tracks. Fitness logs. Recovery reflects. Study teaches.
                Install an extension and the tree gains a new way to act on its nouns.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#f97316"}}>Routing is parsing</h3>
              <p>
                "Ate eggs" has food nouns. "Bench 135" has fitness nouns. The routing
                index maps territory: which noun-space belongs to which verb.
              </p>
            </div>
            <div className="lp-card">
              <h3 style={{color: "#ecc94b"}}>Modes are conjugation</h3>
              <p>
                <strong>Review</strong> (past): "how did I do."
                <strong> Coach</strong> (future): "what should I."
                <strong> Plan</strong> (imperative): "build", "create."
                <strong> Log</strong> (present): "ate eggs", "bench 135x10."
              </p>
            </div>
          </div>

          <div className="lp-cards-3" style={{gridTemplateColumns: "1fr 1fr", marginTop: 12}}>
            <div className="lp-card" style={{padding: "14px 16px"}}>
              <h3 style={{color: "#f97316", fontSize: "0.95rem"}}>Adjectives = Metadata</h3>
              <p style={{fontSize: "0.85rem"}}>135lb. 5x5. Ready for progression. Values, goals, and status describe each noun.</p>
            </div>
            <div className="lp-card" style={{padding: "14px 16px"}}>
              <h3 style={{color: "#7dd385", fontSize: "0.95rem"}}>Adverbs = Instructions</h3>
              <p style={{fontSize: "0.85rem"}}>"Be concise." "Use kg." They modify how the verb behaves without changing the verb.</p>
            </div>
            <div className="lp-card" style={{padding: "14px 16px"}}>
              <h3 style={{color: "#c4c8d0", fontSize: "0.95rem"}}>Prepositions = Tree Structure</h3>
              <p style={{fontSize: "0.85rem"}}>Under, above, next to. Parent, ancestor, sibling. Spatial scoping is prepositional.</p>
            </div>
            <div className="lp-card" style={{padding: "14px 16px"}}>
              <h3 style={{color: "#f472b6", fontSize: "0.95rem"}}>Articles = Existence</h3>
              <p style={{fontSize: "0.85rem"}}>"THE bench press" routes to a node that exists. "A bench press" triggers sprout to create it.</p>
            </div>
          </div>

          <p className="lp-section-sub" style={{marginTop: 24, maxWidth: 620}}>
            The system is a natural language computer. The seed is the parser.
            Extensions are the vocabulary. The tree is the syntax tree. The user just talks.
          </p>
        </div>
      </section>

      {/* ── THE DEEPER LAYERS ── */}
      <section className="lp-section lp-section-alt">
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

      {/* ── HOW TO ORGANIZE YOUR TREE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Organizing Your Tree</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Two approaches. Different tradeoffs. The right one depends on whether your domains share context.
          </p>

          <div style={{display: "grid", gridTemplateColumns: "1fr 1fr", gap: 20, marginTop: 24}}>
            <div style={{padding: 20, borderRadius: 12, background: "rgba(72,187,120,0.06)", border: "1px solid rgba(72,187,120,0.12)"}}>
              <h3 style={{color: "#4ade80", fontSize: "1rem", margin: "0 0 12px"}}>Separate Trees</h3>
              <div style={{fontFamily: "monospace", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", lineHeight: 1.8, marginBottom: 12}}>
                Land<br/>
                {"├── "}Health (tree root)<br/>
                {"│   ├── "}Fitness/...<br/>
                {"│   └── "}Food/...<br/>
                {"├── "}Study (tree root)<br/>
                {"├── "}Datacenter Ops (tree root)<br/>
                {"└── "}Recovery (tree root)
              </div>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.85rem", lineHeight: 1.7, margin: 0}}>
                Each tree has its own purpose thesis, its own conversation boundary, its own rings.
                Navigate between them and the conversation resets. The AI at Health doesn't carry context
                from Datacenter Ops. Best when domains are unrelated.
              </p>
            </div>
            <div style={{padding: 20, borderRadius: 12, background: "rgba(102,126,234,0.06)", border: "1px solid rgba(102,126,234,0.12)"}}>
              <h3 style={{color: "#667eea", fontSize: "1rem", margin: "0 0 12px"}}>One Tree, Many Branches</h3>
              <div style={{fontFamily: "monospace", fontSize: "0.8rem", color: "rgba(255,255,255,0.5)", lineHeight: 1.8, marginBottom: 12}}>
                Life (tree root)<br/>
                {"├── "}Health<br/>
                {"│   ├── "}Fitness/...<br/>
                {"│   └── "}Food/...<br/>
                {"├── "}Learning<br/>
                {"│   └── "}Study/...<br/>
                {"├── "}Work<br/>
                {"│   └── "}KB/...<br/>
                {"└── "}Recovery/...
              </div>
              <p style={{color: "rgba(255,255,255,0.45)", fontSize: "0.85rem", lineHeight: 1.7, margin: 0}}>
                One conversation. One purpose thesis. Navigate between Health and Learning and the AI
                remembers. Channels between siblings are internal cascade. Rings capture the whole life.
                Best when everything is connected.
              </p>
            </div>
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.8, marginTop: 24, textAlign: "center"}}>
            The rule: if the domains share context, one tree. If they don't, separate trees.
            Health and Food share context. Datacenter Ops and personal fitness don't.
          </p>
        </div>
      </section>

      {/* ── GATEWAY ROUTING ── */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Gateway Routing</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A gateway maps an external platform to a position in the tree. Any position.
            The message arrives. The classifier detects the extension. The mode fires. The response returns.
          </p>

          <div style={{
            background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "20px 24px",
            fontFamily: "monospace", fontSize: "0.85rem", color: "rgba(255,255,255,0.55)", lineHeight: 2,
            marginBottom: 20,
          }}>
            <div style={{color: "rgba(255,255,255,0.35)", marginBottom: 8}}># Map a platform to a specific branch</div>
            treeos gateway map telegram /Health/Food/Log<br/>
            treeos gateway map discord /Work/KB/Topics<br/>
            <br/>
            <div style={{color: "rgba(255,255,255,0.35)", marginBottom: 8}}># Or map to the root. The tree routes internally.</div>
            treeos gateway map telegram /Life
          </div>

          <p style={{color: "rgba(255,255,255,0.5)", fontSize: "0.9rem", lineHeight: 1.8}}>
            One Telegram bot. One entry point. The tree figures out where everything goes.
            "Ate chicken for lunch" routes to Food. "Bench 135x10" routes to Fitness.
            "What's the server layout" routes to KB. You just talk. The tree routes.
          </p>

          <div style={{
            background: "rgba(255,255,255,0.03)", borderRadius: 10, padding: "16px 20px",
            fontFamily: "monospace", fontSize: "0.82rem", color: "rgba(255,255,255,0.5)", lineHeight: 1.9,
            marginTop: 20,
          }}>
            <span style={{color: "rgba(255,255,255,0.3)"}}>telegram {">"} </span>
            ate chicken for lunch<br/>
            <span style={{color: "rgba(255,255,255,0.25)"}}>{"  "}classifier checks /Life children</span><br/>
            <span style={{color: "rgba(255,255,255,0.25)"}}>{"  "}finds Health/Food, hints match "ate" + "chicken"</span><br/>
            <span style={{color: "rgba(255,255,255,0.25)"}}>{"  "}routes to /Life/Health/Food/Log</span><br/>
            <span style={{color: "#4ade80"}}>Logged: chicken breast (165 cal, 31g protein)</span><br/>
            <span style={{color: "#4ade80"}}>Today: protein 49/150g (33%)</span>
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
            <a className="lp-btn lp-btn-primary" href="/lands">Start a Land</a>
            <a className="lp-btn lp-btn-secondary" href="/what">More Into TreeOS</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/guide">Guide</a>
            <a className="lp-btn lp-btn-secondary" href="https://horizon.treeos.ai">Horizon</a>
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
              <a href="/swarm">Swarm</a>
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

export default TreeOSPage;
