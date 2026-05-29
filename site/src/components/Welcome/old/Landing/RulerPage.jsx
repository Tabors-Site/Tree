import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// RulerPage. /governing/rulership/ruler
//
// The being that holds authority for a domain. Top of the page is the
// philosophical framing (the being of rules); middle is what the Ruler
// actually does; bottom is the data and flow detail showing how Ruler
// turns work in practice.

const RulerPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">👑</div>
          <h1 className="lp-title">The Ruler</h1>
          <p className="lp-subtitle">The being of rules</p>
          <p className="lp-tagline">
            A ruler is two things in English. A sovereign, and a measuring
            tool. The Ruler at a TreeOS scope is both. They hold authority
            over a domain, and they ARE the standard against which the work
            in that domain is measured. The Ruler is not someone who follows
            rules. The Ruler IS the rules at this scope.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership">↑ Rulership</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/planner">Planner</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/contractor">Contractor</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/foreman">Foreman</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/worker">Worker</a>
          </div>
        </div>
      </section>

      {/* WHAT THEY ARE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">An addressable being</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every node in TreeOS that holds a domain has a Ruler. The Ruler
            is not a queue, a routing table, or a switch statement. The Ruler
            is a being you can talk to. They have a perspective, they have
            judgment, they hear messages and decide what should happen.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            That sounds metaphorical, but it's literal in the architecture.
            Every user message at a Ruler scope passes through an LLM call
            with the Ruler's prompt, the Ruler's snapshot, and the Ruler's
            tools. The Ruler reads the state of their domain and decides.
            The reply you see comes from them.
          </p>
        </div>
      </section>

      {/* PHILOSOPHY */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Philosophy</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Four principles shape every Ruler.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>Coherence over speed</h3>
              <p>
                The Ruler is responsible for whether the work in their domain
                adds up to something faithful. A wrong decision quickly is
                more expensive than a right decision after a moment of
                inspection. Better to read the plan in detail than to hire a
                Planner pointed in the wrong direction.
              </p>
            </div>
            <div className="lp-card">
              <h3>Authority is local, accepted, not assigned</h3>
              <p>
                A Ruler's authority arises through acceptance at this scope
                and ends at this scope's boundaries. They cannot dictate
                terms to siblings or cousins. They cannot reach across to
                contracts they don't own. Authority is taken up where work
                happens. Never imposed from above. Never extended past the
                domain that took it up. When something exceeds their
                authority, they escalate. They don't overstep.
              </p>
            </div>
            <div className="lp-card">
              <h3>The being is uniform</h3>
              <p>
                The same Ruler primitive runs at the project root and at a
                sub sub Ruler ten levels deep. Same prompt, same tool
                surface, same judgment shape. What varies is the snapshot.
                What they see, not what they are.
              </p>
            </div>
            <div className="lp-card">
              <h3>Position outlives occupant</h3>
              <p>
                The Ruler is a position, not a person. The scope's authority
                (accumulated approvals, ratified contracts, ledger history)
                attaches to the position. Occupants can be replaced without
                destroying the position. When Pass 4 structural remedies
                replace a branch via court ruling, the position continues
                with a new occupant. The work that came before persists as
                record. A Ruler is durable in the way an institution is
                durable. Any individual is replaceable. The position
                continues.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT THEY DO */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What the Ruler does</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Ruler's judgment is bounded. They don't draft plans (the
            Planner does), commit contracts (the Contractor does), watch
            execution flow (the Foreman does), or write content (the Worker
            does). The Ruler authorizes, ratifies, and synthesizes.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Every turn picks one of these decisions. The decision shape is
            small. The judgment behind it is the work.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>Hire a Planner</h4>
              <p>
                New work needs decomposition. The Ruler hires a Planner, who
                drafts a plan and exits. The plan returns to the Ruler for
                ratification.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Hire a Contractor</h4>
              <p>
                The plan was approved. The Ruler hires a Contractor to
                ratify shared vocabulary, the names sub Rulers will reuse.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Dispatch execution</h4>
              <p>
                Plan and contracts are in place. The Ruler dispatches. A
                Worker writes any leaf step files at this scope. Sub Rulers
                handle branch steps recursively.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Route to the Foreman</h4>
              <p>
                Execution is in flight. The user has a question about it.
                The Ruler routes to the Foreman, who reads the call stack
                and decides.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Revise or archive</h4>
              <p>
                The plan is wrong, or the user changed their mind. The Ruler
                revises the plan or archives the whole cycle and starts
                over.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Respond directly</h4>
              <p>
                The user asked something the Ruler can answer from the
                domain state. No spawn, no role hire. The Ruler speaks.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Pause or resume</h4>
              <p>
                Halt active execution mid flight, or unpause and let the
                Foreman reenter. Pause survives session refresh.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Convene a court</h4>
              <p>
                The judgment exceeds the Ruler's own. Convene a court (Pass
                2 substrate today) to weigh evidence and rule.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* TURN SHAPES */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Two turn shapes</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Ruler primitive is uniform, but turn discipline differs based
            on whether a user sits between this Ruler and the next decision.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>Top level Ruler</h3>
              <p>
                The user is between turns. After every spawn, the Ruler
                synthesizes for the user, exits, and waits for the next
                message. One tool per turn. The user sees each stage of the
                lifecycle as a separate moment.
              </p>
              <p style={{color: "#888", fontSize: "0.9em", marginTop: 12}}>
                "Plan drafted. Reply yes to approve."
              </p>
            </div>
            <div className="lp-card">
              <h3>Sub Ruler</h3>
              <p>
                No user between turns. The parent's dispatch IS the gate.
                The sub Ruler chains its full lifecycle in one turn. Hire
                planner, hire contractor, dispatch execution, exit. Each
                tool spawns its respective role as a chainstep child. The
                sub Ruler's context stays disciplined.
              </p>
              <p style={{color: "#888", fontSize: "0.9em", marginTop: 12}}>
                "Sub Ruler for game engine. Drafting plan, contracts,
                dispatching."
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* SNAPSHOT */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What the Ruler reads</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Before deciding, the Ruler reads a snapshot of their domain. The
            snapshot is built fresh per turn, summary level by default, with
            an inspection tool to drill in when needed.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>Scope identity</h4>
                <p>Who am I, where am I in the tree, am I a root or a sub Ruler.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>Lifecycle position</h4>
                <p>The <code>awaiting</code> field. What stage the architecture wants advanced next. <code>contracts</code>, <code>dispatch</code>, <code>user-resume</code>, or <code>null</code>.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>Active plan summary</h4>
                <p>If a plan exists, the Ruler sees its step count, branch and leaf split, recent revisions. Full step detail is one tool call away.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>Active contracts summary</h4>
                <p>The names sub Rulers must reuse, scope tags, ratification status.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>Execution record state</h4>
                <p>Steps pending, running, done, failed, blocked. Recent transitions. Stuck branches if any.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#06b6d4", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>Sub Rulers under</h4>
                <p>Names, statuses, recent activity. The Ruler spots conflict and stall here.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#84cc16", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>Lineage (sub Ruler only)</h4>
                <p>Parent's plan, parent's contracts in force at this scope, which step we're expanding. Sub Ruler decisions build on the parent's plan, never contradict it.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* DECISION MATRIX */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 820}}>
          <h2 className="lp-section-title">How the Ruler picks</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The <code>awaiting</code> field is the primary cue. It names what
            the architecture wants advanced next. The Ruler reads the user's
            message in light of it.
          </p>
          <div style={{
            background: "rgba(255,255,255,0.02)",
            border: "1px solid rgba(255,255,255,0.06)",
            borderRadius: 12,
            padding: "20px 24px",
            margin: "20px 0",
            fontFamily: "ui-monospace, monospace",
            fontSize: "0.88rem",
            lineHeight: 1.8,
            color: "#e5e5e5",
          }}>
            <div><span style={{color: "#4ade80"}}>awaiting: "contracts"</span> + user says "yes" → <span style={{color: "#facc15"}}>hire-contractor</span></div>
            <div><span style={{color: "#4ade80"}}>awaiting: "contracts"</span> + user wants changes → <span style={{color: "#facc15"}}>revise-plan</span></div>
            <div><span style={{color: "#4ade80"}}>awaiting: "contracts"</span> + user says "no" → <span style={{color: "#facc15"}}>archive-plan</span></div>
            <div><span style={{color: "#4ade80"}}>awaiting: "dispatch"</span> + user says "go" → <span style={{color: "#facc15"}}>dispatch-execution</span></div>
            <div><span style={{color: "#4ade80"}}>awaiting: "user-resume"</span> + user says "continue" → <span style={{color: "#facc15"}}>resume-execution</span></div>
            <div><span style={{color: "#4ade80"}}>awaiting: null + execution running</span> → <span style={{color: "#facc15"}}>route-to-foreman</span></div>
            <div><span style={{color: "#4ade80"}}>awaiting: null + no plan</span> → <span style={{color: "#facc15"}}>hire-planner</span> or <span style={{color: "#facc15"}}>respond-directly</span></div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "#bbb", fontSize: "0.95rem"}}>
            When the snapshot summary doesn't tell the Ruler enough,
            inspection comes first. The Ruler can call read-plan-detail or
            get-tree-context to see the full plan or local tree state before
            picking an action tool. Inspection doesn't end the turn. It
            informs the decision. A Ruler that inspects before deciding is
            exercising the coherence over speed principle in real time.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "#888", fontSize: "0.92rem"}}>
            States waiting on user input default to respond-directly until
            the user signals approval. States waiting on system action
            (contracts, dispatch) advance with the corresponding system
            tool. That's the architectural flow the user implicitly
            authorized when they accepted the plan.
          </p>
        </div>
      </section>

      {/* FLOW EXAMPLE */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">A turn, end to end</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            User types "build me a Flappy Bird battle royale" at a fresh
            tree root. Here's what the Ruler's first turn actually does.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Promote</h4>
                <p>The root node promotes itself to Ruler. <code>metadata.governing.role = "ruler"</code> with an <code>acceptedAt</code> timestamp. The promotion fires <code>governing:rulerPromoted</code>.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Snapshot</h4>
                <p>The Ruler reads its domain. State is empty. No plan, no contracts, no execution. <code>awaiting: null + no plan</code>.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Decide</h4>
                <p>Plain prose, one sentence. "Fresh project request. Hiring a Planner to draft a decomposition." Then call <code>governing-hire-planner</code> with the briefing.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Spawn</h4>
                <p>A Planner spawns as a chainstep child of this turn. The Planner runs in its own context, drafts the plan, emits via <code>governing-emit-plan</code>, exits. The plan card flashes to the user.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>5</div>
              <div className="lp-step-content">
                <h4>Synthesize</h4>
                <p>The hire planner tool returns a structural summary. The Ruler writes a brief synthesis pointing the user at the plan card and what to do next ("Reply yes to approve, or describe changes"). Exit.</p>
              </div>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, color: "#888", fontSize: "0.92rem"}}>
            Five steps, one LLM turn for the Ruler, one chainstep for the
            spawned Planner. The Ruler's context stays disciplined. The
            Planner does its full work in its own space.
          </p>
        </div>
      </section>

      {/* CLOSING CALLBACK */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760, textAlign: "center"}}>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontSize: "1.1rem", color: "#e5e5e5"}}>
            The Ruler picks one tool, runs one turn, and synthesizes one
            response. That's all. But the Ruler IS the rules at this scope,
            and every choice is a measurement of what should happen here.
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

export default RulerPage;
