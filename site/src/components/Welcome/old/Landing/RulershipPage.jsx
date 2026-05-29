import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// RulershipPage. Pass 1 governing detail.
//
// Explains the five role primitives (Ruler, Planner, Contractor, Foreman,
// Worker), how they compose at every depth, and how a typical request
// flows through them. Bridges from the high level overview down to each
// role's own detail page.

const RulershipPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">👑</div>
          <h1 className="lp-title">Rulership</h1>
          <p className="lp-subtitle">Pass 1. The role taxonomy.</p>
          <p className="lp-tagline">
            Five roles compose into a uniform pattern at every scope. Ruler
            decides what happens. Planner advises on decomposition. Contractor
            commits shared vocabulary. Foreman manages execution. Worker
            builds. Each is an addressable being with judgment, not a
            programmatic flow.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/governing">↑ Governing</a>
            <a className="lp-btn lp-btn-secondary" href="/swarm">Swarm</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
          </div>
        </div>
      </section>

      {/* THE FIVE ROLES */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">The five roles</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Each role has distinct judgment and a distinct tool surface. They
            compose into governance at every depth. Same shape at the root,
            same shape ten levels down.
          </p>
          <div className="lp-cards">
            <a className="lp-card" href="/governing/rulership/ruler" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h3>👑 Ruler</h3>
              <p>
                The addressable being at a scope. Holds authority for the
                domain. Hears every user message at this scope. Reads the
                state of its plan, contracts, and execution. Decides what
                happens via tool selection.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Persistent as position. The Ruler is the scope's office. The
                occupant filling it can change over time, but the position
                and its accumulated authority continue.
              </p>
              <p style={{color: "#4ade80", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>Read more &nbsp;→</p>
            </a>
            <a className="lp-card" href="/governing/rulership/planner" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h3>🧭 Planner</h3>
              <p>
                Drafts the decomposition when a Ruler hires it. Reads the
                briefing, traverses the local tree, considers available
                extensions, emits a structured plan with reasoning, exits.
                Domain neutral. The Planner doesn't know what code or prose
                is.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Transient. Runs once per hire, emits via governing-emit-plan,
                exits.
              </p>
              <p style={{color: "#4ade80", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>Read more &nbsp;→</p>
            </a>
            <a className="lp-card" href="/governing/rulership/contractor" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h3>📜 Contractor</h3>
              <p>
                Drafts shared vocabulary contracts shaped around an approved
                plan. Validates that every contract's scope sits at or above
                the Lowest Common Ancestor of its named consumers. Hands
                contracts back to the Ruler for ratification.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Transient. Runs once per hire, emits via
                governing-emit-contracts, exits.
              </p>
              <p style={{color: "#4ade80", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>Read more &nbsp;→</p>
            </a>
            <a className="lp-card" href="/governing/rulership/foreman" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h3>🛠️ Foreman</h3>
              <p>
                Watches execution as a call stack. Wakes for judgment
                required cases (branch failed, swarm completed, resume
                requested) and decides retry vs escalate vs pause vs
                cancel subtree based on the stack state. Routine forward
                motion stays programmatic.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Persistent for the duration of an execution. Re invoked on
                lifecycle events.
              </p>
              <p style={{color: "#4ade80", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>Read more &nbsp;→</p>
            </a>
            <a className="lp-card" href="/governing/rulership/worker" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h3>🔨 Worker</h3>
              <p>
                The only role that produces artifacts. Where the other
                four roles coordinate, judge, ratify, and watch, the
                Worker actually builds. Executes leaf work under
                contracts in force. Workspace extensions specialize
                Worker for their domain.{" "}
                <strong>code workspace</strong> adds file editing tools
                and code validators. <strong>book workspace</strong>{" "}
                adds chapter writing and prose validators.{" "}
                <strong>civilization</strong> adds civic action tools
                and community norm validators. The other four roles
                stay domain neutral. Same machinery whether the work is
                code, prose, or civic coordination.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Domain specialized. Runs at leaf scopes, never at branch
                scopes.
              </p>
              <p style={{color: "#4ade80", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>Read more &nbsp;→</p>
            </a>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24}}>
            The architectural principle. Governing owns the coordination
            surface. Workspaces keep their domain specific surface. This
            separation is what lets a single TreeOS instance host code
            projects, books, civic work, and future domains in the same
            substrate without each extension reinventing how branches
            coordinate.
          </p>
        </div>
      </section>

      {/* BOUNDED JUDGMENT (Thread 6) */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Bounded judgment</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The roles aren't peers. Each has bounded judgment that composes
            into a clear chain of responsibility.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The Ruler holds authority and ratifies. The Planner advises but
            doesn't commit. Its emissions become real only after the Ruler
            approves. The Contractor commits scoped vocabulary, but only what
            the Ruler ratifies. The Foreman judges execution flow but
            escalates ambiguity back to the Ruler. The Worker executes within
            ratified contracts and never beyond them.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            This bounding is what keeps responsibility traceable. Every
            decision has a clear signer. Every commitment has a clear
            authority. When something goes wrong at depth, the chain of
            accountability runs back through specific positions to the Ruler
            who ratified the work.
          </p>
        </div>
      </section>

      {/* LIFECYCLE FLOW */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">How a request flows</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A typical compound request like "build me a Flappy Bird battle
            royale" walks through the roles like this. At each step the Ruler
            is the user facing voice. The spawned roles do their work in
            their own chainstep contexts and return concise summaries.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>User to Ruler</h4>
                <p>
                  The request arrives at the Ruler scope. The Ruler reads its
                  domain state. Plan, contracts, execution. State is empty.
                  This is fresh work.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Ruler hires Planner</h4>
                <p>
                  The Ruler calls <code>governing-hire-planner</code>. A
                  Planner spawns as a chainstep child, drafts the
                  decomposition with reasoning, emits the plan, exits. The
                  Ruler reads the structural summary and shows the plan card
                  to the user.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>User approves</h4>
                <p>
                  The user sees the plan and replies "yes" or "approve", or
                  asks for revisions. On approval, the Ruler advances the
                  lifecycle.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Ruler hires Contractor</h4>
                <p>
                  The Ruler calls <code>governing-hire-contractor</code>. A
                  Contractor spawns, drafts contracts shaped around the
                  approved plan, validates LCA correctness, emits the
                  contract set, exits. The Ruler ratifies.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>5</div>
              <div className="lp-step-content">
                <h4>Ruler dispatches execution</h4>
                <p>
                  The Ruler calls <code>governing-dispatch-execution</code>.
                  A Worker writes any leaf step files at this scope (root
                  configs, integration shells). For each branch step, swarm
                  promotes the child node to a sub Ruler and dispatches a
                  recursive turn at that depth.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#06b6d4", color: "#000"}}>6</div>
              <div className="lp-step-content">
                <h4>Sub Rulers run in parallel</h4>
                <p>
                  Each sub Ruler runs its own full lifecycle in one turn. No
                  user gate at sub scope, since the parent already approved.
                  Plan, contract, dispatch, all in one autonomous chain. Sub
                  sub Rulers below them do the same. The recursion bottoms
                  out at Workers at leaves.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#facc15", color: "#000"}}>7</div>
              <div className="lp-step-content">
                <h4>Foreman judges terminal status</h4>
                <p>
                  When all sub Rulers settle, the Foreman wakes. It reads the
                  execution stack. Which steps succeeded, which failed, which
                  contracts held. It freezes the record at the appropriate
                  terminal status (completed, failed, cancelled) and returns
                  a summary up to the Ruler.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#84cc16", color: "#000"}}>8</div>
              <div className="lp-step-content">
                <h4>Ruler synthesizes for the user</h4>
                <p>
                  The Ruler reads the Foreman's summary, holds the coherence
                  of the whole scope, and writes a brief synthesis. What was
                  built. What failed. What's next.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ALIVENESS AT EVERY LAYER (Thread 3) */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Aliveness at every layer is uniform</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A sub Ruler at depth five governs its scope with the same
            authority a root Ruler has over the whole tree. Same primitive,
            same tools, same judgment surface. Only lineage position differs.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Sub Rulers don't wait for user gates. The parent's dispatch IS
            the gate. They drive their full lifecycle (hire planner, hire
            contractor, dispatch execution) in one autonomous turn. TreeOS
            distributes authority to where work happens rather than
            concentrating it at the top.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The cost compounds at depth. A four deep tree may run dozens of
            LLM calls. The architecture accepts that cost because the
            alternative is degraded judgment at the layers where work
            actually lives.
          </p>
        </div>
      </section>

      {/* COHERENCE OVER SPEED (Thread 4) */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Coherence over speed</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A Ruler isn't a fast switch. It's a being holding the coherence
            of its scope. Each Ruler turn reads accumulated state through a
            structured snapshot, inspects detail when judgment requires it,
            and synthesizes for the user only after seeing what its spawned
            roles produced.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The architecture chooses correctness over throughput at every
            decision point. A Ruler that picks the right tool after a moment
            of inspection is more valuable than one that picks fast and
            wrong. This is why the Ruler's tool surface includes inspection
            (read plan detail, read branch detail, get tree context)
            alongside action. Judgment needs to see clearly before acting.
          </p>
        </div>
      </section>

      {/* SELF PROMOTION LIFECYCLE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Authority is accepted, not assigned</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A node becomes a Ruler the moment it accepts authority for a
            domain. Authority isn't assigned from above. It arises through
            acceptance at the scope where the work happens. This is the
            architecture's claim that responsibility can't be imposed. It
            has to be taken up by the position closest to the consequences.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Three uniform call sites. Same primitive (<code>promoteToRuler</code>),
            same metadata (<code>governing.role = "ruler"</code> plus an{" "}
            <code>acceptedAt</code> ISO timestamp), same lifecycle event at
            every depth.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>Root, on user request</h4>
              <p>
                The first time a user message arrives at a tree root, the
                root promotes itself before dispatching its Planner. Every
                user driven project starts with this promotion.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Branch, on dispatch</h4>
              <p>
                When a parent's execution dispatches a branch step, the child
                node is promoted to Ruler before its own Planner runs. The
                branch IS a sub Ruler, not a Worker pretending to coordinate.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Worker, mid build</h4>
              <p>
                When a Worker recognizes the leaf work is actually compound
                and needs sub branches, its own node promotes retroactively
                and the sub branches dispatch under the new Ruler. The same
                primitive at every depth.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* POSITIONS PERSIST (Thread 1) */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Positions persist. Occupants are replaceable.</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A Ruler is a position, not a person. The scope's authority
            (accumulated approvals, ratified contracts, ledger history)
            attaches to the position. Occupants can be replaced without
            destroying the position.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            When Pass 4 structural remedies replace a branch via court
            ruling, the position continues with a new occupant. The work
            that came before persists as record. The architecture has
            continuity that no individual Ruler does.
          </p>
        </div>
      </section>

      {/* LCA CORRECTNESS */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">LCA correctness</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every contract has a scope. <code>global</code>,{" "}
            <code>shared:[X,Y]</code>, or <code>local:[X]</code>. The rule.
            The Lowest Common Ancestor of the contract's named consumers
            must sit at or above the Contractor's emission position.
            Otherwise the contract claims authority over work the Contractor
            doesn't own.
          </p>
          <div style={{
            padding: "20px 24px",
            borderLeft: "3px solid rgba(74, 222, 128, 0.4)",
            background: "rgba(74, 222, 128, 0.03)",
            borderRadius: "0 12px 12px 0",
            margin: "20px 0",
          }}>
            <p style={{color: "#e5e5e5", fontSize: "0.95rem", lineHeight: 1.7, margin: 0}}>
              <strong style={{color: "#4ade80"}}>Valid.</strong> A Contractor
              at the project root may emit{" "}
              <code>shared:[frontend, backend]</code>. Root is the LCA of
              those branches.
            </p>
          </div>
          <div style={{
            padding: "20px 24px",
            borderLeft: "3px solid rgba(239, 68, 68, 0.4)",
            background: "rgba(239, 68, 68, 0.03)",
            borderRadius: "0 12px 12px 0",
            margin: "20px 0",
          }}>
            <p style={{color: "#e5e5e5", fontSize: "0.95rem", lineHeight: 1.7, margin: 0}}>
              <strong style={{color: "#ef4444"}}>Rejected.</strong> A
              Contractor at <code>frontend</code> may not emit{" "}
              <code>shared:[frontend, backend]</code>. That scope reaches
              outside frontend's domain. The contract is rejected at parse
              time. The Contractor re emits with a scope it actually owns.
            </p>
          </div>
          <p className="lp-section-sub lp-section-sub-wide">
            This is what keeps coordination boundaries honest as trees grow
            deep. Without LCA correctness, sub Rulers could dictate terms to
            siblings or cousins they have no authority over, and the tree
            would lose the property that scope matches authority.
          </p>
        </div>
      </section>

      {/* SUBSTRATE FOR BECOMING (Thread 5 expanded) */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Substrate for becoming</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Rulership writes more than data. It writes the conditions under
            which work, beings, and domains have lives over time. Approval
            ledgers give every decision a timestamp and an accountable
            signer. Plan emissions preserve the reasoning that produced the
            decomposition. Contracts persist as durable vocabulary the scope
            owns. Branch outcomes record what shipped, what failed, and why.
            Foreman wakeups record the moments when stack discipline
            required judgment.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Together, these accumulate into something more than execution
            traces. They're the substrate that makes a tree more than its
            current state. A Ruler that has run for months has a track
            record. A scope that has hosted many plans has precedent. A
            contract that has survived ten ratifications is a stable name.
            The substrate is what lets continuity, accumulated identity, and
            reputation become real things across time.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            <strong>Pass 2 (Courts)</strong> will read approval ledgers
            and adjudicate cases governing surfaces.{" "}
            <strong>Pass 3 (Reputation)</strong> will read branch
            outcomes and contract conformance to score future routing
            decisions. <strong>Pass 4 (Structural Remedies)</strong>{" "}
            will let Rulership intervene when reputation signal or court
            ruling calls for it. Quarantines, replacements,
            decommissioning. The conservative corrective tool when
            something at the structural level needs fixing.{" "}
            <strong>Pass 5 (Economy)</strong> will route resources
            through budget primitives Rulership maintains.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Each pass layers on top of what's already here. Rulership is the
            foundation. The rest is layered consumers.
          </p>
        </div>
      </section>

      {/* ROLE DEEP DIVES */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Role deep dives</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Each role has its own page covering tools, judgment surface,
            snapshot reads, and composition with the others.
          </p>
          <div className="lp-cards">
            <a className="lp-card lp-card-sm" href="/governing/rulership/ruler" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h4>👑 Ruler</h4>
              <p>The being of rules at a scope.</p>
            </a>
            <a className="lp-card lp-card-sm" href="/governing/rulership/planner" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h4>🧭 Planner</h4>
              <p>The cartographer of work.</p>
            </a>
            <a className="lp-card lp-card-sm" href="/governing/rulership/contractor" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h4>📜 Contractor</h4>
              <p>The binder of seams.</p>
            </a>
            <a className="lp-card lp-card-sm" href="/governing/rulership/foreman" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h4>🛠️ Foreman</h4>
              <p>The watcher at the front.</p>
            </a>
            <a className="lp-card lp-card-sm" href="/governing/rulership/worker" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h4>🔨 Worker</h4>
              <p>The hand of the work.</p>
            </a>
          </div>
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

export default RulershipPage;
