import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// SwarmPage. /swarm
//
// Swarm is now a pure execution engine. Plan emission and contract
// ratification moved to governing in v0.2. This page reflects that.
// What swarm still owns: parallel branch dispatch, branch status
// tracking, tree authoritative reconciliation, sibling visibility,
// resume detection across sessions.

const SwarmPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🐝</div>
          <h1 className="lp-title">Swarm</h1>
          <p className="lp-subtitle">The parallel execution engine</p>
          <p className="lp-tagline">
            Swarm takes a plan that already carries branch steps and runs
            those branches in parallel. It dispatches each branch into
            its own session, tracks status, retries failures, surfaces
            sibling state, and resumes interrupted work across sessions.
            Mechanism, not policy. Governing decides what gets done.
            Swarm does the doing in parallel.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/governing">Governing</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership">Rulership</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/code">Code</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
          </div>
        </div>
      </section>

      {/* WHAT SWARM IS NOW */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">What swarm is now</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A compound task is one that naturally splits into independent
            sub investigations that need to reconverge. Build a server plus
            a frontend plus tests. Write a research paper with literature
            review, methodology, results, discussion. Draft a book, one
            branch per chapter. Design a data pipeline with ingestion,
            transform, validate, export.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Swarm is the engine that runs those branches in parallel
            without losing track of them. It does not draft the
            decomposition. It does not ratify the shared vocabulary. It
            does not decide who gets what work. Those are{" "}
            <a href="/governing">governing</a>'s job. Swarm reads
            governing's emissions and runs the branches the plan named,
            in the modes the plan declared, under the contracts in
            force.
          </p>
        </div>
      </section>

      {/* DIVISION OF LABOR */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Division of labor</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            In v0.2, swarm shed the work it shouldn't have been doing.
            Plan emission, contract ratification, role coordination
            moved to governing. What remained is the part swarm was
            always best at. Parallel dispatch and bookkeeping.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>👑 Governing owns</h3>
              <p>
                Plan emission via the Planner. Contract ratification via
                the Contractor. Role coordination via the Ruler. Call
                stack discipline via the Foreman. Workspace specialized
                production via the Worker. The deciding and the
                judging.
              </p>
            </div>
            <div className="lp-card">
              <h3>🐝 Swarm owns</h3>
              <p>
                Parallel branch dispatch. Branch status tracking. Tree
                authoritative reconciliation. Sibling visibility. Resume
                detection across sessions. The mechanism that makes
                governing's plans run in parallel without anyone losing
                track of what's happening.
              </p>
            </div>
            <div className="lp-card">
              <h3>🔧 Workspaces own</h3>
              <p>
                Domain specific tools and validators that fire on
                swarm's lifecycle hooks. code workspace runs syntax
                checks, contract conformance, smoke tests. book
                workspace runs voice continuity, character consistency.
                Whatever the domain produces, the workspace validates.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">How it works</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Five phases. Each is mechanical. Plan in, branches running,
            results out.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Reconcile</h4>
                <p>
                  Before any dispatch, swarm runs <code>reconcileProject</code>{" "}
                  to walk the actual tree children and merge them with
                  the cached subPlan. New children become pending
                  entries. Deleted children drop. Renamed or rewritten
                  specs refresh from node metadata. The tree is ground
                  truth. The cache adopts reality.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Dispatch</h4>
                <p>
                  For each branch step in the plan, swarm promotes the
                  child node to a sub Ruler (via governing's
                  promoteToRuler) and spawns a recursive turn at that
                  scope. Contracts in force at the parent scope are
                  visible to the sub Ruler. The sub Ruler runs its own
                  full lifecycle. Plan, contract, dispatch.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Track</h4>
                <p>
                  Swarm watches the branch step status. Pending,
                  running, done, failed, blocked. Status writes are
                  atomic and dual sourced (plan node and swarm
                  metadata) so the picture stays consistent even across
                  concurrent dispatches.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Reconverge</h4>
                <p>
                  When all branches at a step settle, swarm fires{" "}
                  <code>swarm:afterAllBranchesComplete</code>. The
                  Foreman wakes to judge terminal status. Workspace
                  validators run. Failures get retried (or escalated
                  per the Foreman's decision). Success rolls up.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>5</div>
              <div className="lp-step-content">
                <h4>Resume</h4>
                <p>
                  When a session is killed mid build,{" "}
                  <code>detectResumableSwarm</code> walks the tree to
                  find branches still pending or running. The Foreman
                  reads the resumable set on next user contact and
                  decides whether to redispatch. Pause markers and
                  frame anchors written by the Foreman survive session
                  refresh.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* TREE AUTHORITATIVE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Tree authoritative</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The most important architectural property of swarm. The
            tree node graph is ground truth. Cached state (subPlan,
            queues, in memory progress) is a working copy that
            reconciles against the tree on every dispatch and resume.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            This matters because trees outlive sessions. A user can
            navigate away, edit nodes by hand, import work from offline
            tools, run mycelium federation that mutates a peer's tree.
            Two weeks later, swarm picks up where it left off. Not by
            trusting its cache. By rereading the tree.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Without this property, every recovery would mean rebuilding
            state from scratch or trusting stale assumptions. With it,
            the tree is the database, and swarm is just the runtime
            that animates the parallel dispatch.
          </p>
        </div>
      </section>

      {/* SIBLING VISIBILITY */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Siblings are legible</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Branches don't run blind. <code>readSiblingBranches</code>{" "}
            returns a read only snapshot of every sibling branch's state
            and descendant notes. Domain neutral. Domain extensions
            render it however they want.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>code workspace</h4>
              <p>
                Renders sibling state as a partial file tree. The
                frontend branch can see what files the backend branch
                has produced before writing its fetch calls.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>book workspace</h4>
              <p>
                Renders sibling state as chapter summaries. Chapter
                seven can see which characters are alive after chapter
                six landed.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>research workspace</h4>
              <p>
                Renders sibling state as section claims. The discussion
                branch sees what the methodology branch committed
                before drawing conclusions.
              </p>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24}}>
            The visibility is structural, not coordinated by hand.
            Branches that need each other's outputs read them through
            the same primitive regardless of domain.
          </p>
        </div>
      </section>

      {/* HOOK LIFECYCLE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Hook lifecycle</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Swarm fires hooks at every stage of dispatch. Workspace
            extensions subscribe to add domain specific behavior
            without importing swarm directly.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>swarm:afterProjectInit</h4>
                <p>The project is initialized and ready for dispatch. Workspaces can stamp project level metadata or seed structural files.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>swarm:beforeBranchRun</h4>
                <p>A branch is about to dispatch. Workspaces can inject per branch context, claim resources, or prepare validator state.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>swarm:afterBranchComplete</h4>
                <p>A branch declared done. Workspaces run per branch validators (syntax, smoke, voice, citation) and stamp status.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>swarm:branchRetryNeeded</h4>
                <p>A branch failed validation and the Foreman judged it recoverable. The branch will redispatch with the failure reason in context.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>swarm:afterAllBranchesComplete</h4>
                <p>All branches at a step settled. The Foreman wakes for terminal status judgment. Workspaces can run cross branch validators (integration, seam, contract conformance).</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#06b6d4", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>swarm:runScouts</h4>
                <p>The seam verification phase. Scouts run cross branch checks, route discovered issues back into branch inboxes for redispatch. Loops until clean or capped.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT MOVED */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">What moved to governing</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Earlier versions of swarm carried responsibilities that
            didn't really fit. v0.2 moved them to governing where they
            belong. If you remember the old shape, here's the map.
          </p>
          <ul>
            <li>The architect (decomposition role) is now governing's <a href="/governing/rulership/planner">Planner</a>.</li>
            <li>Contract emission is now governing's <a href="/governing/rulership/contractor">Contractor</a>, with Ruler ratification.</li>
            <li>Plan lifecycle events (proposed, updated, archived) moved to <code>governing:plan*</code> hooks.</li>
            <li>The judgment surface for failures and resume decisions is now governing's <a href="/governing/rulership/foreman">Foreman</a>.</li>
            <li>Branch dispatch into a sub Ruler turn replaces the old direct mode dispatch. Each branch is a recursive Ruler scope, not a Worker pretending to coordinate.</li>
          </ul>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24}}>
            What stayed in swarm. Everything mechanical. Reconciliation,
            dispatch, status tracking, sibling visibility, resume
            detection. The plumbing that makes parallel branches run
            without governing having to babysit them.
          </p>
        </div>
      </section>

      {/* PHILOSOPHY */}
      <section className="lp-section lp-section-alt" style={{paddingBottom: 60}}>
        <div className="lp-container" style={{textAlign: "center", maxWidth: 720}}>
          <h2 className="lp-section-title">Why parallel execution is a primitive</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Humans already do this. Teams split a project into parts,
            each person works in their own head, and they reconverge
            through shared language and specs. The word "branch" isn't
            new. The word "merge" isn't new. What's new is making
            parallel execution native to an AI operating system instead
            of a process a human ties together.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "rgba(255,255,255,0.7)"}}>
            Small models don't have room to hold a backend, a frontend,
            a persistence layer, and a test suite in the same context
            window. They can hold one of those at a time. Swarm gives
            each one its own context, its own position, its own
            conversation. Coherence is handled by the contracts (which
            governing ratifies), not by cramming everything into one
            turn.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "rgba(255,255,255,0.7)"}}>
            The result is compound work that would take a 200B model
            hours in one shot, done by many 27B models in parallel with
            governing keeping them aligned and swarm keeping them moving.
          </p>
          <div style={{marginTop: 32}}>
            <a className="lp-btn lp-btn-secondary" href="/governing">Governing</a>
            <a className="lp-btn lp-btn-secondary" href="/code" style={{marginLeft: 12}}>See It In Code</a>
            <a className="lp-btn lp-btn-secondary" href="/seed" style={{marginLeft: 12}}>Back to the Seed</a>
          </div>
        </div>
      </section>

      {/* FOOTER */}
      <footer className="lp-footer">
        <div className="lp-container">
          <div className="lp-footer-grid">
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

export default SwarmPage;
