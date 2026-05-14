import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// GoverningPage. Overview of the five governing layers.
//
// Top-level orientation page for anyone landing on TreeOS and trying to
// understand how it coordinates work. Establishes two framings: domains
// are held by Rulers (the OS analogy), and governing is the glue of
// seams (what it actually does day to day). Lists the five layers with
// click-through to their detail pages. Pass 1 (Rulership) is shipped;
// the rest are in design.

const GoverningPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">👑</div>
          <h1 className="lp-title">Governing</h1>
          <p className="lp-subtitle">The coordination glue of TreeOS</p>
          <p className="lp-tagline">
            Without governing, a tree is a folder structure. With it, every
            scope becomes an addressable domain where work coordinates across
            branches without drifting apart. Governing is what makes the seams
            between branches hold.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership">Rulership</a>
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/swarm">Swarm</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
          </div>
        </div>
      </section>

      {/* DOMAINS ARE RULERS */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Domains, not directories</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A traditional OS holds files in directories. Permissions and
            ownership decorate the tree, but a directory itself doesn't decide
            anything. It's just a place where files live.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            TreeOS holds work in domains. A domain is the same kind of place
            but with a being who governs it: the Ruler. Every Ruler scope is
            addressable, holds authority for its work, hires roles, ratifies
            contracts, decides what happens at that depth. The directory
            becomes a domain the moment a Ruler accepts authority for it.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The mental bridge is short. If you know directories with files,
            you know domains with Rulers. Same shape, with judgment added.
          </p>
        </div>
      </section>

      {/* POSITIONS PERSIST (Thread 1) */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Positions persist. Occupants are replaceable.</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A Ruler isn't a person. It's a position. The scope's authority is
            a durable architectural fact. Accumulated approvals, ratified
            contracts, and ledger history all attach to the position, not to
            whoever happens to be filling it.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Who fills the position can change. Pass 4 structural remedies
            replace occupants without destroying positions, the way an
            institution survives any individual's tenure. The architecture has
            continuity that no single Ruler does.
          </p>
        </div>
      </section>

      {/* AUTHORITY IS ACCEPTED (Thread 2) */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Authority is accepted, not assigned</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A node becomes a Ruler the moment it accepts authority for its
            domain. Not by external decree. By acceptance at the scope where
            the work happens.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Three uniform call sites. A root node accepts authority when a
            user request arrives. A branch accepts authority when dispatched
            as a sub Ruler. A Worker accepts authority retroactively when it
            discovers its work is compound. Same lifecycle event at every
            depth. Authority emerges where accountability sits, never from
            above.
          </p>
        </div>
      </section>

      {/* THE FIVE LAYERS */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The five layers</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Governing composes in layers. Each pass adds machinery on top of
            the previous. Rulership is the foundation. Everything else builds
            on it.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Aliveness at every layer is uniform. A sub Ruler at depth five
            governs its domain with the same authority a root Ruler has over
            the whole tree. TreeOS distributes authority to where work
            happens rather than concentrating it at the top.
          </p>
          <div className="lp-cards">
            <a className="lp-card" href="/governing/rulership" style={{textDecoration: "none", color: "inherit", display: "block"}}>
              <h3>👑 Rulership</h3>
              <p>
                Who decides what happens at each scope. Ruler hears, considers,
                routes work to Planner, Contractor, Foreman, or Worker. Every
                scope has an addressable being holding authority.
              </p>
              <p style={{color: "#4ade80", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>
                Pass 1. Shipped. &nbsp;→
              </p>
            </a>
            <div className="lp-card">
              <h3>⚖️ Courts</h3>
              <p>
                How disagreements get adjudicated. When sub Rulers conflict,
                contracts get violated, or work fails for ambiguous reasons,
                a court convenes to weigh evidence and rule.
              </p>
              <p style={{color: "#888", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>
                Pass 2. Designed.
              </p>
            </div>
            <div className="lp-card">
              <h3>📊 Reputation</h3>
              <p>
                How accumulated track record shapes future decisions. Branches
                that consistently deliver gain weight. Ones that drift lose
                it. Reputation is governing's memory.
              </p>
              <p style={{color: "#888", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>
                Pass 3. Designed.
              </p>
            </div>
            <div className="lp-card">
              <h3>🔧 Structural Remedies</h3>
              <p>
                The conservative corrective tool. When reputation signal
                says a position is failing repeatedly, or a court rules
                that something at the structural level needs fixing,
                Rulership can act through structural remedies.
                Quarantines isolate a misbehaving scope. Replacements
                swap an occupant while the position continues.
                Decommissioning retires a position whose work is no
                longer needed. Reserved for cases where things have
                actually gone wrong. Used rarely and deliberately, not
                as a routine motion.
              </p>
              <p style={{color: "#888", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>
                Pass 4. Designed.
              </p>
            </div>
            <div className="lp-card">
              <h3>💰 Economy</h3>
              <p>
                How resources flow through the tree. Branches bid for work,
                coalitions form around contracts, budgets route attention to
                where outcomes warrant it.
              </p>
              <p style={{color: "#888", fontSize: "0.85em", fontWeight: 600, marginTop: 12}}>
                Pass 5. Designed.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* GLUE OF SEAMS */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Glue of seams</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The work governing does isn't abstract. It's what happens at the
            places where two parts of a tree have to align.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>Shared names</h4>
              <p>
                When two branches need to share something like an event, a
                type, or a storage key, governing places the contract for that
                name at the scope that owns it. Not deeper, not shallower.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Conflict resolution</h4>
              <p>
                When sub Rulers produce work that's individually consistent
                but jointly inconsistent, governing surfaces the contradiction
                for adjudication instead of letting it pile on.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Failure judgment</h4>
              <p>
                When a branch fails, governing decides what happens. Retry,
                escalate to the parent Ruler, pause the subtree, freeze the
                record. Not all failures are the same shape.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Frame discipline</h4>
              <p>
                Trees execute like call stacks. Step N+1 doesn't start until
                step N's entire descendant subtree settles. Governing is what
                holds that discipline.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Scope correctness</h4>
              <p>
                A contract emitted at scope A can't claim authority over work
                at scope B unless A contains B. Governing rejects scope
                violations at parse time so coordination boundaries stay
                honest.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Lifecycle ratification</h4>
              <p>
                Plans, contracts, executions all pass through Ruler approval
                ledgers. Nothing advances without a Ruler signing off. That's
                the audit trail courts and reputation will read.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* COHERENCE OVER SPEED (Thread 4) */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Coherence over speed</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Governing chooses correctness over throughput. A Ruler that picks
            the wrong tool quickly is more expensive than one that reads state
            carefully and picks the right tool a moment later.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Inspection tools, lifecycle position fields, and approval ledgers
            all exist so judgment can see clearly before acting. The
            architecture refuses to optimize for speed at the cost of
            coherence.
          </p>
        </div>
      </section>

      {/* GENERAL SUBSTRATE */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">A general substrate</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Governing isn't a workspace. It's the substrate workspaces
            consume. Any extension that needs multi branch coordination plugs
            into governing rather than reimplementing it. The Worker is the
            part each workspace specializes. The rest of the roles (Ruler,
            Planner, Contractor, Foreman) stay domain neutral and come from
            governing uniformly.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>💻 code workspace</h4>
              <p>
                Consumes governing for code projects. The Worker adds file
                editing tools, build pipelines, and code validators (syntax,
                smoke, contract conformance). The seams are file imports, type
                signatures, wire protocols.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>📖 book workspace</h4>
              <p>
                Consumes governing for prose and long form work. The Worker
                adds chapter writing tools and prose validators (voice,
                continuity, character consistency). The seams are character
                arcs, timeline, terminology.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>🏛️ civilization</h4>
              <p>
                Consumes governing for civic and community coordination. The
                Worker adds civic action tools and community norm validators.
                The seams are agreements, jurisdictions, shared resources.
                Governing isn't just for engineering work.
              </p>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24}}>
            That's why a single TreeOS instance can host code projects,
            books, civic work, research collaboratives, and design studios
            all in the same substrate without each domain reinventing how
            branches coordinate. Governing owns the coordination surface.
            Workspaces keep their domain specific surface. The pattern is
            uniform. The content varies.
          </p>
        </div>
      </section>

      {/* SUBSTRATE FOR BECOMING (Thread 5) */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Substrate for becoming</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Governing isn't just coordination. It's substrate. The properties
            governing gives every Ruler scope (continuity through approval
            ledgers, accumulated history, vulnerability to failure, judgment
            with consequences, addressable identity over time) are the
            conditions under which something can persist as itself rather
            than just execute and dissolve.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Pass 1 establishes the substrate. Pass 2 makes adjudication real.
            Pass 3 gives accumulated history weight. Pass 4 lets the system
            surgically intervene. Pass 5 gives resource flow agency. The
            substrate is what makes a tree more than its current execution.
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

export default GoverningPage;
