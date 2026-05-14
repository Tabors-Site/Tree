import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// GoverningPage. Overview of the five governing layers.
//
// Top-level orientation page for anyone landing on TreeOS and trying to
// understand how it coordinates work. Six inline-SVG diagrams carry the
// architectural story so the page reads as an at-a-glance system poster
// instead of a text wall. Each diagram is paired with the narrative
// content it visualizes, so a video demo can pan between the chat panel
// and any diagram to anchor what's being explained.

const ROLE_COLORS = {
  ruler: "#facc15",      // gold
  planner: "#60a5fa",    // blue
  contractor: "#c084fc", // purple
  foreman: "#fb923c",    // orange
  worker: "#4ade80",     // green
};

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

      {/* DIAGRAM 1: RULERSHIP TREE-OF-SCOPES */}
      <section className="lp-section" style={{paddingTop: 40, paddingBottom: 40}}>
        <div className="lp-container">
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", marginBottom: 24, fontSize: 15, color: "rgba(255,255,255,0.55)"}}>
            Every scope is a domain. Every domain has a Ruler. Sub-Rulers nest under parent Rulers.
          </p>
          <div className="gov-diagram-wrap">
            <svg viewBox="0 0 920 360" className="gov-diagram" role="img" aria-label="Rulership tree of scopes">
              {/* connection lines: root → 3 sub-Rulers */}
              <g stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none">
                <path d="M460 68 L240 140" />
                <path d="M460 68 L460 140" />
                <path d="M460 68 L680 140" />
                {/* leftmost sub-Ruler (center bottom 240,188) → 4 roles (top center 90, 185, 280, 375 at y=280) */}
                <path d="M240 188 L 90 280" />
                <path d="M240 188 L185 280" />
                <path d="M240 188 L280 280" />
                <path d="M240 188 L375 280" />
                {/* middle sub-Ruler (460,188) → 2 deeper sub-Rulers (430,280 and 510,280) */}
                <path d="M460 188 L430 280" />
                <path d="M460 188 L510 280" />
                {/* right sub-Ruler (680,188) → 1 deeper sub (680,280) */}
                <path d="M680 188 L680 280" />
              </g>

              {/* Root Ruler (center x = 460) */}
              <RulerNode x={380} y={20} w={160} h={48} label="Root Ruler" sub="/MyProject" />

              {/* Sub-Rulers */}
              <RulerNode x={160} y={140} w={160} h={48} label="Sub-Ruler" sub="/MyProject/api" />
              <RulerNode x={380} y={140} w={160} h={48} label="Sub-Ruler" sub="/MyProject/ui" />
              <RulerNode x={600} y={140} w={160} h={48} label="Sub-Ruler" sub="/MyProject/db" />

              {/* 4 roles under the leftmost sub-Ruler. Width 80, centers at 90/185/280/375 */}
              <RoleNode x={50}  y={280} label="Planner"    glyph="📋" color={ROLE_COLORS.planner} />
              <RoleNode x={145} y={280} label="Contractor" glyph="📜" color={ROLE_COLORS.contractor} />
              <RoleNode x={240} y={280} label="Foreman"    glyph="🏗️" color={ROLE_COLORS.foreman} />
              <RoleNode x={335} y={280} label="Worker"     glyph="🔨" color={ROLE_COLORS.worker} />

              {/* middle sub-Ruler: 2 deeper sub-Rulers. Width 60, centers at 430 and 510 */}
              <RulerNode x={400} y={280} w={60} h={36} label="Sub" sub="…" small />
              <RulerNode x={480} y={280} w={60} h={36} label="Sub" sub="…" small />

              {/* right sub-Ruler: 1 deeper (center x=680, width 60) */}
              <RulerNode x={650} y={280} w={60} h={36} label="Sub" sub="…" small />
            </svg>

            <div className="gov-legend">
              <span style={{color: ROLE_COLORS.ruler}}>👑 Ruler</span>
              <span style={{color: ROLE_COLORS.planner}}>📋 Planner</span>
              <span style={{color: ROLE_COLORS.contractor}}>📜 Contractor</span>
              <span style={{color: ROLE_COLORS.foreman}}>🏗️ Foreman</span>
              <span style={{color: ROLE_COLORS.worker}}>🔨 Worker</span>
            </div>
          </div>
        </div>
      </section>

      {/* DOMAINS ARE RULERS */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 880}}>
          <h2 className="lp-section-title">Domains, not directories</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A traditional OS holds files in directories. TreeOS holds work in
            domains. Same shape with judgment added.
          </p>
          <div className="gov-compare">
            <div className="gov-compare-col">
              <h4>📁 Traditional OS</h4>
              <ul>
                <li>Directory holds files</li>
                <li>Permissions decorate the tree</li>
                <li>Directory doesn't decide</li>
                <li>Just a place</li>
              </ul>
            </div>
            <div className="gov-compare-col gov-compare-col-accent">
              <h4>🌳 TreeOS</h4>
              <ul>
                <li>Domain holds work</li>
                <li>Ruler accepts authority</li>
                <li>Domain has judgment</li>
                <li>A place with a being</li>
              </ul>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, textAlign: "center"}}>
            The directory becomes a domain the moment a Ruler accepts authority for it.
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
        <div className="lp-container">
          <h2 className="lp-section-title">Authority is accepted, not assigned</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 720, margin: "0 auto 32px"}}>
            Three uniform call sites. Same lifecycle event at every depth.
          </p>

          {/* DIAGRAM 2: three call sites converging on a new Ruler */}
          <div className="gov-diagram-wrap">
            <svg viewBox="0 0 760 360" className="gov-diagram" role="img" aria-label="Three call sites that accept authority">
              <defs>
                <marker id="arrow" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="rgba(255,255,255,0.4)" />
                </marker>
              </defs>

              <CallSiteLane x={60}  label="user request"           accept="accept @ root"      ruler="👑 new Ruler" color="#4ade80" />
              <CallSiteLane x={300} label="branch dispatched"      accept="accept @ branch"    ruler="👑 new Ruler" color="#60a5fa" />
              <CallSiteLane x={540} label="worker finds compound"  accept="accept retroactive" ruler="👑 new Ruler" color="#c084fc" />

              {/* unifying caption below the three lanes */}
              <line x1="120" y1="320" x2="640" y2="320" stroke="rgba(255,255,255,0.12)" strokeWidth="1" strokeDasharray="4,4" />
              <text x="380" y="345" textAnchor="middle" fill="rgba(255,255,255,0.55)" fontSize="13" fontStyle="italic">
                Same lifecycle event at every depth. Authority emerges where accountability sits.
              </text>
            </svg>
          </div>
        </div>
      </section>

      {/* DIAGRAM 3: THE FIVE LAYERS AS A STACK */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The five layers</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 720, margin: "0 auto 32px"}}>
            Governing composes in layers. Rulership is the foundation. Each pass builds on the previous.
          </p>

          <div className="gov-stack">
            <div className="gov-layer gov-layer-future">
              <span className="gov-layer-icon">💰</span>
              <span className="gov-layer-name">Economy</span>
              <span className="gov-layer-desc">Resources flow through the tree. Bids, coalitions, budgets.</span>
              <span className="gov-layer-pass">Pass 5 · Designed</span>
            </div>
            <div className="gov-layer gov-layer-future">
              <span className="gov-layer-icon">🔧</span>
              <span className="gov-layer-name">Structural Remedies</span>
              <span className="gov-layer-desc">Quarantine. Replace. Decommission. Rare and deliberate.</span>
              <span className="gov-layer-pass">Pass 4 · Designed</span>
            </div>
            <div className="gov-layer gov-layer-future">
              <span className="gov-layer-icon">📊</span>
              <span className="gov-layer-name">Reputation</span>
              <span className="gov-layer-desc">Track record shapes future weight. Governing's memory.</span>
              <span className="gov-layer-pass">Pass 3 · Designed</span>
            </div>
            <div className="gov-layer gov-layer-future">
              <span className="gov-layer-icon">⚖️</span>
              <span className="gov-layer-name">Courts</span>
              <span className="gov-layer-desc">Adjudicate disagreements. Weigh evidence. Rule.</span>
              <span className="gov-layer-pass">Pass 2 · Designed</span>
            </div>
            <a className="gov-layer gov-layer-shipped" href="/governing/rulership">
              <span className="gov-layer-icon">👑</span>
              <span className="gov-layer-name">Rulership</span>
              <span className="gov-layer-desc">Who decides at each scope. Hires roles. Ratifies contracts.</span>
              <span className="gov-layer-pass">Pass 1 · Shipped ✓</span>
            </a>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 28, textAlign: "center", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            Aliveness is uniform. A sub-Ruler at depth five governs its domain with the same authority a root Ruler has over the whole tree.
          </p>
        </div>
      </section>

      {/* DIAGRAM 4: ROLES INSIDE A RULER (exploded view) */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Roles inside a Ruler scope</h2>
          <p className="lp-section-sub lp-section-sub-wide" style={{textAlign: "center", maxWidth: 720, margin: "0 auto 32px"}}>
            The Ruler holds the scope. Four named roles do the work the Ruler ratifies.
          </p>

          <div className="gov-diagram-wrap">
            <svg viewBox="0 0 880 280" className="gov-diagram" role="img" aria-label="The four roles inside a Ruler scope">
              {/* connection lines from Ruler to 4 roles */}
              <g stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" fill="none">
                <path d="M440 80 L110 170" />
                <path d="M440 80 L330 170" />
                <path d="M440 80 L550 170" />
                <path d="M440 80 L770 170" />
              </g>

              {/* Ruler box */}
              <g>
                <rect x="320" y="20" width="240" height="60" rx="12"
                  fill="rgba(250, 204, 21, 0.10)" stroke={ROLE_COLORS.ruler} strokeWidth="2" />
                <text x="440" y="48" textAnchor="middle" fill="#fde68a" fontSize="18" fontWeight="600">👑 Ruler</text>
                <text x="440" y="68" textAnchor="middle" fill="rgba(255,255,255,0.6)" fontSize="11">hears · considers · routes · ratifies</text>
              </g>

              {/* 4 role boxes */}
              <RoleBigNode x={30}  y={170} label="Planner"    glyph="📋" color={ROLE_COLORS.planner}    desc="drafts plans" />
              <RoleBigNode x={250} y={170} label="Contractor" glyph="📜" color={ROLE_COLORS.contractor} desc="ratifies contracts" />
              <RoleBigNode x={470} y={170} label="Foreman"    glyph="🏗️" color={ROLE_COLORS.foreman}    desc="call stack discipline" />
              <RoleBigNode x={690} y={170} label="Worker"     glyph="🔨" color={ROLE_COLORS.worker}     desc="executes in domain" />
            </svg>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 16, textAlign: "center", fontSize: 15, color: "rgba(255,255,255,0.6)"}}>
            Workspaces specialize the Worker. Ruler, Planner, Contractor, Foreman stay domain-neutral.
          </p>
        </div>
      </section>

      {/* GLUE OF SEAMS */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Glue of seams</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The work governing does isn't abstract. It's what happens at the
            places where two parts of a tree have to align.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>🏷️ Shared names</h4>
              <p>
                When two branches need to share something like an event, a
                type, or a storage key, governing places the contract for that
                name at the scope that owns it. Not deeper, not shallower.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>⚖️ Conflict resolution</h4>
              <p>
                When sub Rulers produce work that's individually consistent
                but jointly inconsistent, governing surfaces the contradiction
                for adjudication instead of letting it pile on.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>🩹 Failure judgment</h4>
              <p>
                When a branch fails, governing decides what happens. Retry,
                escalate to the parent Ruler, pause the subtree, freeze the
                record. Not all failures are the same shape.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>📚 Frame discipline</h4>
              <p>
                Trees execute like call stacks. Step N+1 doesn't start until
                step N's entire descendant subtree settles. Governing is what
                holds that discipline.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>🎯 Scope correctness</h4>
              <p>
                A contract emitted at scope A can't claim authority over work
                at scope B unless A contains B. Governing rejects scope
                violations at parse time so coordination boundaries stay
                honest.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>🗂️ Lifecycle ratification</h4>
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
      <section className="lp-section">
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

      {/* DIAGRAM 6: WORKSPACE SPECIALIZATION */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">A general substrate</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Governing isn't a workspace. It's the substrate workspaces consume.
            The top of every workspace is identical. The Worker is what each
            workspace specializes.
          </p>

          <div className="gov-workspaces">
            <WorkspaceCol
              name="code workspace"
              icon="💻"
              workerLabel="🔨 file edits + validators"
              workerDetail="syntax · smoke · contract conformance"
              color="#60a5fa"
            />
            <WorkspaceCol
              name="book workspace"
              icon="📖"
              workerLabel="🔨 prose + continuity"
              workerDetail="voice · timeline · character consistency"
              color="#fb923c"
            />
            <WorkspaceCol
              name="civilization"
              icon="🏛️"
              workerLabel="🔨 civic action"
              workerDetail="agreements · jurisdictions · shared resources"
              color="#c084fc"
            />
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 28, textAlign: "center"}}>
            One TreeOS instance can host code projects, books, civic work, research
            collaboratives — all in the same substrate. Governing owns coordination.
            Workspaces keep their domain.
          </p>
        </div>
      </section>

      {/* SUBSTRATE FOR BECOMING (Thread 5) */}
      <section className="lp-section">
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

// ── SVG sub-components ─────────────────────────────────────────────

function RulerNode({ x, y, w, h, label, sub, small = false }) {
  const fontSize = small ? 12 : 16;
  const subSize = small ? 9 : 11;
  return (
    <g>
      <rect x={x} y={y} width={w} height={h} rx={small ? 8 : 10}
        fill="rgba(250, 204, 21, 0.10)" stroke={ROLE_COLORS.ruler} strokeWidth="1.5" />
      <text x={x + w / 2} y={y + (small ? 16 : 22)} textAnchor="middle"
        fill="#fde68a" fontSize={fontSize} fontWeight="600">
        👑 {label}
      </text>
      <text x={x + w / 2} y={y + h - (small ? 8 : 14)} textAnchor="middle"
        fill="rgba(255,255,255,0.55)" fontSize={subSize}>
        {sub}
      </text>
    </g>
  );
}

function RoleNode({ x, y, label, glyph, color }) {
  return (
    <g>
      <rect x={x} y={y} width={80} height={40} rx="8"
        fill={`${color}1A`} stroke={color} strokeWidth="1.5" />
      <text x={x + 40} y={y + 24} textAnchor="middle" fill="rgba(255,255,255,0.92)" fontSize="13">
        {glyph} {label}
      </text>
    </g>
  );
}

function RoleBigNode({ x, y, label, glyph, color, desc }) {
  return (
    <g>
      <rect x={x} y={y} width={160} height={84} rx="12"
        fill={`${color}14`} stroke={color} strokeWidth="2" />
      <text x={x + 80} y={y + 32} textAnchor="middle" fill="rgba(255,255,255,0.95)" fontSize="17" fontWeight="600">
        {glyph} {label}
      </text>
      <text x={x + 80} y={y + 58} textAnchor="middle" fill="rgba(255,255,255,0.65)" fontSize="12">
        {desc}
      </text>
    </g>
  );
}

function CallSiteLane({ x, label, accept, ruler, color }) {
  return (
    <g>
      {/* top: entry point */}
      <rect x={x} y={20} width={160} height={48} rx="10"
        fill="rgba(255,255,255,0.04)" stroke="rgba(255,255,255,0.18)" strokeWidth="1.5" />
      <text x={x + 80} y={50} textAnchor="middle" fill="rgba(255,255,255,0.85)" fontSize="13">
        {label}
      </text>

      {/* arrow down */}
      <path d={`M${x + 80} 76 L${x + 80} 110`} stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />

      {/* middle: accept */}
      <rect x={x} y={118} width={160} height={48} rx="10"
        fill={`${color}1A`} stroke={color} strokeWidth="1.5" />
      <text x={x + 80} y={148} textAnchor="middle" fill="rgba(255,255,255,0.9)" fontSize="13">
        {accept}
      </text>

      {/* arrow down */}
      <path d={`M${x + 80} 174 L${x + 80} 208`} stroke="rgba(255,255,255,0.3)" strokeWidth="1.5" fill="none" markerEnd="url(#arrow)" />

      {/* bottom: new Ruler */}
      <rect x={x} y={216} width={160} height={56} rx="10"
        fill="rgba(250, 204, 21, 0.10)" stroke={ROLE_COLORS.ruler} strokeWidth="2" />
      <text x={x + 80} y={250} textAnchor="middle" fill="#fde68a" fontSize="15" fontWeight="600">
        {ruler}
      </text>
    </g>
  );
}

function WorkspaceCol({ name, icon, workerLabel, workerDetail, color }) {
  return (
    <div className="gov-workspace-col">
      <div className="gov-workspace-name">{icon} {name}</div>
      <div className="gov-workspace-gov">
        <div className="gov-workspace-gov-title">governing (uniform)</div>
        <div className="gov-workspace-gov-roles">
          <span>👑</span><span>📋</span><span>📜</span><span>🏗️</span>
        </div>
      </div>
      <div className="gov-workspace-worker" style={{borderColor: color}}>
        <div className="gov-workspace-worker-label" style={{color}}>{workerLabel}</div>
        <div className="gov-workspace-worker-detail">{workerDetail}</div>
      </div>
    </div>
  );
}

export default GoverningPage;
