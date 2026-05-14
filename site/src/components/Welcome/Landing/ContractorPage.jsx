import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// ContractorPage. /governing/rulership/contractor
//
// The transient role that ratifies shared vocabulary. Top frames the
// Contractor as the seam binder; middle covers what they do; bottom is
// the LCA correctness data and flow.

const ContractorPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">📜</div>
          <h1 className="lp-title">The Contractor</h1>
          <p className="lp-subtitle">The binder of seams</p>
          <p className="lp-tagline">
            Where two branches meet, something has to hold the seam. A
            shared name, a shared shape, a shared assumption. The Contractor
            is the role that commits those shared things in writing. They
            read the approved plan, identify what crosses branch boundaries,
            and ratify contracts that pin those names down. Without
            contracts, parallel work drifts. With them, the seams hold.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership">↑ Rulership</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/ruler">Ruler</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/planner">Planner</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/foreman">Foreman</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/worker">Worker</a>
          </div>
        </div>
      </section>

      {/* WHAT THEY ARE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">A transient witness</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Like the Planner, the Contractor is transient. They run when
            hired, ratify the contracts shaped around an approved plan, and
            exit. They don't enforce the contracts they emit. That's the
            workspace's validators. They commit the shared vocabulary on
            the record so everyone downstream has the same words for the
            same things.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            A contract is whatever invariant keeps parallel branches
            coherent. In code, it's wire message types and storage keys.
            In prose, it's character names and timeline. In civic work,
            it's agreements and jurisdictions. The shape is domain
            specific. The commitment shape is uniform.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Same principle as the Planner. Positions persist but occupants
            don't. The contracts a Contractor emits become durable
            architectural facts. The Contractor that drafted them does
            not. When contracts need revision, a fresh Contractor
            approaches the work without defending the previous emission.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            "In writing" means in the architectural record. Every ratified
            contract carries a timestamp, a Contractor signature, a Ruler
            ratification, and the reasoning that justified it. Pass 2
            courts will read these records when adjudicating disputes
            about what was agreed. The Contractor's job is to make the
            agreement legible enough to be adjudicated.
          </p>
        </div>
      </section>

      {/* PHILOSOPHY */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Philosophy</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Three principles shape every Contractor emission.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>Shared vocabulary first</h3>
              <p>
                The Contractor doesn't write code or prose. They name the
                things parallel work needs to agree on (events, types,
                keys, terms) before any branch starts producing. Names
                ratified upstream are non negotiable downstream.
              </p>
            </div>
            <div className="lp-card">
              <h3>Scope matches authority</h3>
              <p>
                A Contractor can only emit contracts at scopes their Ruler
                actually owns. Reaching outside the domain is rejected at
                parse time. This is what keeps coordination boundaries
                honest as trees grow deep.
              </p>
            </div>
            <div className="lp-card">
              <h3>Less is more</h3>
              <p>
                Contracts are commitments. Each one constrains future
                work. The Contractor names what genuinely crosses
                boundaries and stops there.
              </p>
              <p>
                Over contracting freezes flexibility. Every implementation
                detail becomes a ratified name nobody can change without
                re ratification. Under contracting lets seams drift.
                Branches diverge on what they thought they agreed on, and
                integration breaks at the worst moment.
              </p>
              <p>
                The Contractor aims for the minimum that holds. Every
                contract should be one nobody can route around without
                breaking the seam, and nothing more.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT THEY DO */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What the Contractor does</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            One job, four phases, then exit.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Read the approved plan</h4>
                <p>
                  The Ruler hires the Contractor after a plan is ratified.
                  The Contractor reads the plan, the parent contracts in
                  force, and the briefing.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Identify shared vocabulary</h4>
                <p>
                  Where do the plan's branches need to agree? Event names
                  fired by one and consumed by another. Storage keys
                  written by one and read by another. Wire shapes that
                  cross the seam. DOM ids the integration layer
                  references.
                </p>
                <p>
                  Some shared things stay uncommitted on purpose.
                  Conventions inherited from the workspace, default
                  behaviors that don't need to be named, choices that
                  shouldn't be locked because they'll evolve. The
                  Contractor leaves these alone. Contracts are for what
                  genuinely needs ratification. Everything else is
                  workspace ground.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Validate scope (LCA)</h4>
                <p>
                  For each contract, the Contractor checks the scope. The
                  Lowest Common Ancestor of its named consumers must sit
                  at or above the Contractor's emission position.
                  Contracts that overreach get rejected. The Contractor
                  re scopes.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Emit and exit</h4>
                <p>
                  The Contractor calls <code>governing-emit-contracts</code>{" "}
                  with the reasoning and contract set. Contracts persist
                  to the contracts node. The Ruler ratifies. The
                  Contractor exits.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* CONTRACT SHAPE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The shape of a contract</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every contract carries a name, a definition, and a scope.
            Scope is the part most people miss. It's the part that makes
            contracts composable.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>scope: global</h3>
              <p>
                The contract applies everywhere in the domain. Used for
                the most fundamental shared assumptions. The ambient
                vocabulary the whole scope agrees on.
              </p>
            </div>
            <div className="lp-card">
              <h3>scope: shared:[X, Y]</h3>
              <p>
                The contract is shared between named branches X and Y.
                The LCA of X and Y must sit at or above the emission
                position. Used for cross branch interfaces. The seam
                between two specific sub domains.
              </p>
            </div>
            <div className="lp-card">
              <h3>scope: local:[X]</h3>
              <p>
                The contract applies inside branch X only. Rare at the
                Contractor level. Usually local concerns get committed by
                X's own sub Contractor. Used when an upstream needs to
                fix a detail at a specific sub branch.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* LCA EXAMPLES */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 820}}>
          <h2 className="lp-section-title">LCA correctness, in pictures</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Imagine a project root with three branches.{" "}
            <code>frontend</code>, <code>backend</code>, and{" "}
            <code>tests</code>. The Contractor at the project root has
            authority over all three.
          </p>
          <div style={{
            padding: "20px 24px",
            borderLeft: "3px solid rgba(74, 222, 128, 0.4)",
            background: "rgba(74, 222, 128, 0.03)",
            borderRadius: "0 12px 12px 0",
            margin: "20px 0",
          }}>
            <p style={{color: "#4ade80", fontWeight: 600, margin: "0 0 8px"}}>Valid emissions from project root</p>
            <ul style={{color: "#e5e5e5", lineHeight: 1.8, margin: 0, paddingLeft: 24}}>
              <li><code>shared:[frontend, backend]</code>. Root is the LCA. Root has authority.</li>
              <li><code>shared:[frontend, backend, tests]</code>. Root is still the LCA.</li>
              <li><code>global</code>. Implicitly scoped to the whole domain at and below root.</li>
            </ul>
          </div>
          <div style={{
            padding: "20px 24px",
            borderLeft: "3px solid rgba(239, 68, 68, 0.4)",
            background: "rgba(239, 68, 68, 0.03)",
            borderRadius: "0 12px 12px 0",
            margin: "20px 0",
          }}>
            <p style={{color: "#ef4444", fontWeight: 600, margin: "0 0 8px"}}>Invalid emission from inside frontend</p>
            <p style={{color: "#e5e5e5", lineHeight: 1.7, margin: 0}}>
              A Contractor running inside the <code>frontend</code> branch
              tries to emit <code>shared:[frontend, backend]</code>.
              Rejected. Backend is outside frontend's domain. The
              Contractor must re emit with a scope it actually owns
              (e.g., <code>local:[frontend]</code> for a frontend internal
              contract), or the cross branch contract must be raised to
              the parent for the Contractor at the root to handle.
            </p>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "#888", fontSize: "0.92rem"}}>
            This rule is what keeps coordination boundaries honest as
            trees grow deep. A sub Ruler can't dictate terms to siblings
            or cousins. Their authority ends at their own scope.
          </p>
        </div>
      </section>

      {/* EXAMPLE EMISSION */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">An example emission</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Continuing the Flappy Bird Battle Royale. Plan was approved
            with three sub Rulers (core, entities, battle royale). The
            Contractor at the project root identifies cross branch shared
            vocabulary.
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
              Three branches share four event names (tick,
              entityEliminated, arenaStateChanged, powerUpCollected) that
              need consistent shapes across emitter and consumer. tick is
              shared between all three because rendering, entity
              simulation, and arena timing all need the same heartbeat.
              entityEliminated is shared between entities (which kills)
              and battle royale (which tracks elimination state) but core
              doesn't need to know who killed whom. The Entity interface
              is shared between entities (which defines it) and battle
              royale (which inspects entities for elimination eligibility)
              but core sees only the abstract render and update calls.
              Storage keys for game state and DOM ids for the canvas
              viewport are global because the integration shell at root
              scope writes and reads them.
            </p>
            <p style={{color: "#c084fc", fontWeight: 600, marginTop: 16}}>Contracts</p>
            <div style={{fontFamily: "ui-monospace, monospace", fontSize: "0.85rem", lineHeight: 2}}>
              <div><span style={{color: "#facc15"}}>event:tick</span> · <span style={{color: "#888"}}>shared:[core, entities, battle-royale]</span></div>
              <div><span style={{color: "#facc15"}}>event:entityEliminated</span> · <span style={{color: "#888"}}>shared:[entities, battle-royale]</span></div>
              <div><span style={{color: "#facc15"}}>event:arenaStateChanged</span> · <span style={{color: "#888"}}>shared:[battle-royale, entities]</span></div>
              <div><span style={{color: "#facc15"}}>event:powerUpCollected</span> · <span style={{color: "#888"}}>shared:[battle-royale, entities]</span></div>
              <div><span style={{color: "#facc15"}}>interface:Entity</span> · <span style={{color: "#888"}}>shared:[entities, battle-royale]</span></div>
              <div><span style={{color: "#facc15"}}>storage:gameState</span> · <span style={{color: "#888"}}>global</span></div>
              <div><span style={{color: "#facc15"}}>dom:gameCanvas</span> · <span style={{color: "#888"}}>global</span></div>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "#888", fontSize: "0.92rem"}}>
            Each sub Ruler will see the contracts that apply at their
            scope in their snapshot. They build under the contract. Their
            workspace's validators check conformance.
          </p>
        </div>
      </section>

      {/* CLOSING CALLBACK */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760, textAlign: "center"}}>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontSize: "1.1rem", color: "#e5e5e5"}}>
            The seams hold because someone bound them. The binder steps
            away. The bindings remain.
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

export default ContractorPage;
