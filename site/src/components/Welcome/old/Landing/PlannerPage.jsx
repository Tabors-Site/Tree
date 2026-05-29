import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// PlannerPage. /governing/rulership/planner
//
// The transient role that drafts decomposition. Top is the philosophical
// framing (the planner as cartographer); middle is what the Planner does;
// bottom is the data and flow detail.

const PlannerPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🧭</div>
          <h1 className="lp-title">The Planner</h1>
          <p className="lp-subtitle">The cartographer of work</p>
          <p className="lp-tagline">
            The Planner draws the map. Given a briefing and a domain, the
            Planner reads the terrain. The local tree, the available
            extensions, the precedent of nearby work. They propose a path.
            They don't walk it. They don't own it. They draft it, present
            it, exit. The Ruler walks the path. The Planner is the map maker
            who made it possible.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership">↑ Rulership</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/ruler">Ruler</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/contractor">Contractor</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/foreman">Foreman</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/worker">Worker</a>
          </div>
        </div>
      </section>

      {/* WHAT THEY ARE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">A transient advisor</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Planner is not persistent. They run when hired, do their
            work, and exit. The next time the Ruler needs decomposition, a
            fresh Planner spawns with a fresh briefing. Plans persist.
            Planners don't.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            This is deliberate. A persistent Planner would accumulate
            assumptions across cycles and start defending past plans. A
            transient Planner approaches each briefing fresh, with no ego
            attached to the prior plan. The Ruler holds continuity. The
            Planner brings fresh eyes.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            This is the same principle that makes positions durable but
            occupants replaceable elsewhere in TreeOS. Plans persist as
            architectural facts. The cognition that produced them does not.
            Each new Planner is a fresh observer, free to see the work as
            it is rather than as it was framed.
          </p>
        </div>
      </section>

      {/* PHILOSOPHY */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Philosophy</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Three principles shape every Planner emission.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>Domain neutral</h3>
              <p>
                The Planner doesn't know what code is, what a chapter is,
                what a civic action is. They know shape. Leaves vs branches,
                dependencies, scope, ordering. The workspace extension
                supplies the domain semantics. The Planner stays general.
              </p>
              <p>
                This is what lets the same Planner primitive serve a code
                project, a book, a civic coordination. The Planner doesn't
                choose a different reasoning style for different domains.
                It reasons about decomposition shape, and the workspace
                extension provides the domain content the reasoning shapes
                itself around.
              </p>
            </div>
            <div className="lp-card">
              <h3>Reasoning before steps</h3>
              <p>
                Every plan emission carries a reasoning block. The Planner
                explains why this decomposition, what alternatives were
                considered, what tradeoffs were accepted. The Ruler reads
                the reasoning before the steps. Without the reasoning, the
                plan is just a list.
              </p>
            </div>
            <div className="lp-card">
              <h3>Progressive delivery</h3>
              <p>
                A plan should reach a working state early and add layers.
                Core mechanics first, then variety, then edge cases. The
                Planner orders steps so each successful step leaves the
                work more functional, not just more complete.
              </p>
              <p>
                This is depth then pullback applied to decomposition. Get
                to the core that makes the whole thing real, then layer
                outward.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT THEY DO */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What the Planner does</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            One job, one tool. The Planner runs through four phases and
            exits.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Read the briefing</h4>
                <p>
                  The Ruler hires the Planner with a briefing. The user's
                  request, the scope's lineage if sub Ruler, any parent
                  contracts in force. The Planner reads it carefully.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Traverse the local tree</h4>
                <p>
                  The Planner calls <code>get-tree-context</code> to see
                  what's already at this scope. Existing nodes, recent
                  notes, the shape of nearby work. Plans build on what's
                  there.
                </p>
                <p>
                  For sub Ruler scopes, the Planner also reads parent
                  contracts in force at this scope and the lineage block
                  showing which step of the parent's plan this sub Ruler is
                  expanding. The Planner plans within those constraints.
                  Sub plans build on the parent's plan, never contradict
                  it.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Decompose with reasoning</h4>
                <p>
                  The Planner thinks. What's the natural shape of this
                  work? Where does it split? What stays as a leaf? What
                  needs its own sub Ruler? What's the right ordering? The
                  reasoning comes first. The steps follow from it.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Emit and exit</h4>
                <p>
                  The Planner calls <code>governing-emit-plan</code> with
                  the reasoning and the structured step list. The plan
                  persists to the Ruler's plan node. The Planner exits.
                  Their work is done.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* PLAN STRUCTURE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The shape of a plan</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A plan has two parts. Reasoning, in prose. Steps, structured.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>Reasoning</h3>
              <p>
                A paragraph explaining the decomposition. Why this split.
                What alternatives were considered. What's the ordering
                rationale. The Ruler and the user both read this before
                approving. It's the part that makes the plan reviewable
                rather than just a checklist.
              </p>
            </div>
            <div className="lp-card">
              <h3>Steps</h3>
              <p>
                Each step is either a <strong>leaf</strong> (concrete work
                done at this scope by a Worker) or a <strong>branch</strong>{" "}
                (sub domains that promote to sub Rulers and run their own
                full lifecycle). Steps run in order. Branch steps fan out
                in parallel.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* EXAMPLE EMISSION */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">An example emission</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Briefing. "build me a Flappy Bird battle royale game." Here's
            roughly what the Planner emits.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: "20px 24px",
            margin: "20px 0",
            fontSize: "0.92rem",
            lineHeight: 1.7,
            color: "#e5e5e5",
          }}>
            <p style={{color: "#c084fc", fontWeight: 600, marginTop: 0}}>Reasoning</p>
            <p style={{color: "#bbb", fontSize: "0.9rem", lineHeight: 1.7}}>
              For a Flappy Bird Battle Royale, decomposing by separation of
              concerns. Core (rendering, physics, game loop), entities
              (player, AI, obstacles as data driven objects), and battle
              royale (arena, power ups, elimination). The split is by
              stability of contract. Core changes least, battle royale
              changes most. Considered a flat decomposition with all
              features at root, rejected because the entity system needs
              its own internal coordination (player and AI sharing physics)
              that would leak into core if not bounded. Top level files
              (index.html, package.json, vite.config.js) anchor the web
              stack. Progressive delivery. Core must produce a playable
              MVP first (single bird, gravity, pipes), then entities add
              obstacle variety, then battle royale layers arena shrinking
              and power ups. If we run out of time, MVP with just core is
              still a Flappy Bird. Without progressive delivery, we'd have
              a half built battle royale that doesn't fly.
            </p>
            <p style={{color: "#c084fc", fontWeight: 600, marginTop: 16}}>Steps</p>
            <div style={{fontFamily: "ui-monospace, monospace", fontSize: "0.85rem", lineHeight: 2}}>
              <div><span style={{color: "#4ade80"}}>1. leaf</span> Create package.json with vite 5.x dependency.</div>
              <div><span style={{color: "#4ade80"}}>2. leaf</span> Create vite.config.js with alias resolution and build target.</div>
              <div><span style={{color: "#4ade80"}}>3. leaf</span> Create index.html with canvas viewport.</div>
              <div><span style={{color: "#facc15"}}>4. branch</span> Three sub Rulers.</div>
              <div style={{paddingLeft: 24}}><span style={{color: "#888"}}>↳ core</span>. Game loop, rendering, physics.</div>
              <div style={{paddingLeft: 24}}><span style={{color: "#888"}}>↳ entities</span>. Player, AI, obstacles.</div>
              <div style={{paddingLeft: 24}}><span style={{color: "#888"}}>↳ battle-royale</span>. Arena, power ups, elimination.</div>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "#888", fontSize: "0.92rem"}}>
            The Ruler reads this, presents the plan card to the user, and
            waits for approval. On approval, the Ruler hires the Contractor
            to commit shared vocabulary across the three branches.
          </p>
        </div>
      </section>

      {/* WHY TRANSIENT */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Why the Planner exits</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Planner doesn't ratify, dispatch, or supervise. They draft
            and leave. This isn't laziness. It's a load bearing separation.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            If the Planner stuck around to defend their plan, every
            revision would become an argument. If the Planner kept watch
            over execution, they'd start advocating for their decomposition
            over what the work was actually showing. Separating drafting
            from ratification keeps each role honest. The Ruler ratifies
            because they own the scope's outcomes. The Planner drafts
            because they see the shape clearly. Different judgment,
            different roles.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            When the plan turns out to need changes, the Ruler hires a
            fresh Planner with a revised briefing. The new Planner reads
            the existing plan as context but isn't bound to defending it.
          </p>
        </div>
      </section>

      {/* CLOSING CALLBACK */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760, textAlign: "center"}}>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontSize: "1.1rem", color: "#e5e5e5"}}>
            The cartographer drew the map. The map persists. The
            cartographer moves on. The next territory needs its own map,
            drawn fresh.
          </p>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
            <div className="lp-footer-col">
              <h4>Governing</h4>
              <a href="/governing">Overview</a>
              <a href="/governing/rulership">Rulership (Pass 1)</a>
              <a href="/governing/rulership/ruler">Ruler</a>
              <a href="/governing/rulership/planner">Planner</a>
              <a href="/governing/rulership/contractor">Contractor</a>
              <a href="/governing/rulership/foreman">Foreman</a>
              <a href="/governing/rulership/worker">Worker</a>
            </div>
            <div className="lp-footer-col">
              <h4>Docs</h4>
              <a href="/guide">Guide</a>
              <a href="/seed">The Seed</a>
              <a href="/ai">The AI</a>
              <a href="/cascade">Cascade</a>
              <a href="/governing">Governing</a>
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

export default PlannerPage;
