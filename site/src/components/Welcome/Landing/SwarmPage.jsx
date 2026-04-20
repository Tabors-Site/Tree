import "./LandingPage.css";
import Particles from "./Particles.jsx";

const SwarmPage = () => {
  return (
    <div className="lp">

      {/* ── HERO ── */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🐝</div>
          <h1 className="lp-title">Swarm</h1>
          <p className="lp-subtitle">Parallel Inquiry as a Primitive</p>
          <p className="lp-tagline">
            One compound task, many independent branches, one coherent result.
            The architect decomposes. Branches build in isolation. Contracts
            keep the seams aligned. Validators catch drift. The tree turns
            plural problems into parallel work.
          </p>
          <div className="lp-hero-ctas">
            <a className="lp-btn lp-btn-secondary" href="/seed">The Seed</a>
            <a className="lp-btn lp-btn-secondary" href="/ai">The AI</a>
            <a className="lp-btn lp-btn-secondary" href="/cascade">Cascade</a>
            <a className="lp-btn lp-btn-secondary" href="/code">Code</a>
            <a className="lp-btn lp-btn-secondary" href="/extensions">Extensions</a>
          </div>
        </div>
      </section>

      {/* ── WHAT IT IS ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">What Swarm Is</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A compound task is one that naturally splits into independent sub-investigations
            that need to reconverge. Build a server plus a frontend plus tests. Write a
            research paper with a literature review, methodology, results, and discussion.
            Draft a book, one branch per chapter. Design a data pipeline with ingestion,
            transform, validate, export.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Swarm is the primitive that turns these into parallel work without losing
            coherence. The architect writes contracts that define the invariants all
            branches must share. Each branch becomes its own tree node with its own AI
            session, its own workspace, and its own validators. Branches never see each
            other directly. They see the contracts.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            When all branches finish, validators cross-check the actual output against
            the contracts. Any branch that drifted gets flipped to failed with a specific
            violation signal, then retried. The swarm produces a coherent compound result
            or tells you exactly why it couldn't.
          </p>
        </div>
      </section>

      {/* ── HOW IT WORKS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">How It Works</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Five phases. Each phase is its own AI turn or background pass.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Decompose</h4>
                <p>
                  The architect reads the compound request and emits two blocks:
                  <code>[[CONTRACTS]]</code> declares the invariants every branch must
                  respect. <code>[[BRANCHES]]</code> names the sub-investigations with a
                  spec, a mode, a path, and the files or sections each branch owns.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Dispatch</h4>
                <p>
                  Each branch becomes a child node under the project root. Swarm spawns
                  one AI session per branch at its own tree position. Contracts get
                  injected into every branch's system prompt. Branches start blind to
                  each other but aligned to the same invariants.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Build</h4>
                <p>
                  Branches write in parallel. Each emits contract signals as it produces
                  output, which cascade to siblings. A branch that's stuck or ambiguous
                  can read what its siblings have already claimed to hold.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Validate</h4>
                <p>
                  Once all branches declare done, validators fire. Contract conformance
                  checks the actual output against the declared contracts. Domain-specific
                  validators (syntax, seam, smoke, fact-check, citation-check) plug in via
                  hooks. Any violation produces a signal on the offending branch.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>5</div>
              <div className="lp-step-content">
                <h4>Retry and Converge</h4>
                <p>
                  Failed branches get one more shot with the violation signal in their
                  enrichContext. Most small drifts fix on retry. Unfixable ones surface
                  as part of the final plan.md, which writes the distributed subPlan as a
                  human-readable summary.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── VS ORCHESTRATOR ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Swarm vs. Orchestrator</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            These are not the same thing. They work at different layers and for different
            kinds of work.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>Orchestrator</h3>
              <p>
                <strong>One turn, one thought.</strong> The orchestrator takes a single
                natural-language request and decides what to do with it at the current
                position. Parse the grammar. Classify the intent. Pick the mode. Run the
                continuation loop. Dispatch one AI conversation, possibly with many tool
                calls, into one coherent response.
              </p>
              <p>
                It handles nouns, verbs, tenses, pronouns, conjunctions, prepositions.
                It routes between extensions. It respects per-node mode overrides. It's
                the compiler that turns language into execution at a position.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Example: "add a vowel counter to lib.js" — one turn, one file written,
                done.
              </p>
            </div>
            <div className="lp-card">
              <h3>Swarm</h3>
              <p>
                <strong>One request, many parallel conversations.</strong> Swarm takes a
                compound request, decomposes it into independent branches, runs them in
                parallel, and reconverges with cross-branch validation. Each branch is
                its own orchestrator invocation at its own tree position.
              </p>
              <p>
                Swarm does not compile language. It coordinates. It owns the decomposition
                turn (the architect), the parallel build phase, the contract contract
                storage, the validator hook lifecycle, and the retry loop. The orchestrator
                handles each individual branch.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Example: "build a polygon pong chatroom with a backend and a frontend" —
                architect decomposes, two branches build in parallel, contract conformance
                validates, retry fixes the seam.
              </p>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24}}>
            The orchestrator is always running. Swarm only fires when the architect's
            turn produces a <code>[[BRANCHES]]</code> block. A simple request passes
            through the orchestrator and never touches swarm. A compound request passes
            through the orchestrator, hits the architect mode, and hands off to swarm for
            the parallel build.
          </p>
        </div>
      </section>

      {/* ── CONTRACTS ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">Contracts Are the Invariant</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            A contract is whatever invariant keeps parallel branches coherent. The shape
            depends on the domain.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>Code projects</h4>
              <p>
                Wire message types. Payload fields. Shared type definitions. The frontend
                and backend of a WebSocket game agree on every message shape before either
                writes a line.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Research papers</h4>
              <p>
                Terminology definitions. Citation conventions. Variable symbols. Every
                section uses the same term for the same concept.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Books</h4>
              <p>
                Character names. Timeline events. Voice conventions. Chapter four doesn't
                resurrect a character chapter two killed.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Data pipelines</h4>
              <p>
                Schemas for each handoff. Ingestion's output equals transform's input.
                Validate and export share the same field definitions.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Curriculum design</h4>
              <p>
                Learning objectives per module. Prerequisite chains. Shared vocabulary.
                Module three assumes module two's vocabulary is known.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Business plans</h4>
              <p>
                Shared KPIs and assumptions. Market's growth rate equals financials'
                growth rate. Product and ops speak the same customer profile.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── EXTENSIONS THAT USE IT ── */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Extensions That Use Swarm</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Swarm is the common bus. Domain-specific extensions subscribe to its hooks
            and bring their own validators.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>code-workspace</h3>
              <p>
                The reference consumer. Compound code projects decompose into backend,
                frontend, persistence, and shared-contracts branches. Validators include
                syntax, smoke, integration probe, WebSocket seam analysis, and contract
                conformance. Every file write cascades contract signals to siblings.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Live preview per project at <code>/api/v1/preview/&lt;slug&gt;/</code>.
                Contracts keep the wire protocol aligned between the backend's sender and
                the frontend's receiver.
              </p>
            </div>
            <div className="lp-card">
              <h3>research-workspace</h3>
              <p>
                Compound research projects decompose into literature review, methodology,
                results, and discussion branches. Validators check citations, cross-reference
                claims, enforce terminology consistency. Contracts define the vocabulary
                and the citation graph.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Each section is a branch node. The architect produces a claim map. Validators
                flag unsupported assertions against the citation contract.
              </p>
            </div>
            <div className="lp-card">
              <h3>book-workspace</h3>
              <p>
                Long-form drafts decompose into chapter branches. Validators enforce
                character consistency, timeline sanity, voice uniformity. Contracts
                define the cast, the world state, and the narrative voice.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                Chapter seven can't reintroduce a character that died in chapter three.
                The contract is the story bible.
              </p>
            </div>
            <div className="lp-card">
              <h3>curriculum-workspace</h3>
              <p>
                Courses decompose into module branches. Validators enforce prerequisite
                ordering, objective coverage, vocabulary reuse. Contracts define learning
                outcomes and the concept graph.
              </p>
              <p style={{color: "#888", fontSize: "0.9em"}}>
                A module can't teach a concept whose prerequisite isn't covered earlier in
                the sequence.
              </p>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, color: "#888"}}>
            code-workspace ships today. The others are what the primitive enables. Install
            just swarm plus a domain workspace and that kind of compound work becomes
            parallel on your land.
          </p>
        </div>
      </section>

      {/* ── HOOK LIFECYCLE ── */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">The Hook Lifecycle</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Swarm emits hooks at every stage. Extensions subscribe without importing from
            each other.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>afterContractsDeclared</h4>
                <p>Contracts parsed and stored on the project root. Consumers can index them, run schema checks, or prepare validator state.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>onBranchStart</h4>
                <p>A branch's AI session is about to dispatch. Consumers can inject per-branch context, stamp metadata, or claim resources.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>afterBranchFileWrite</h4>
                <p>A branch wrote output. Consumers extract contract signals, run per-file syntax checks, and cascade to siblings.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#ef4444", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>afterBranchComplete</h4>
                <p>A branch declared done. Consumers run per-branch smoke validators and stamp status.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>·</div>
              <div className="lp-step-content">
                <h4>onSwarmComplete</h4>
                <p>All branches finished. Consumers run cross-branch validators (conformance, seam, integration). Violations flip branches to failed, which triggers the retry loop.</p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── PHILOSOPHY ── */}
      <section className="lp-section" style={{paddingBottom: 60}}>
        <div className="lp-container" style={{textAlign: "center"}}>
          <h2 className="lp-section-title">Why Parallel Inquiry Is a Primitive</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Humans already do this. Teams split a project into parts, each person works in
            their own head, and they reconverge through shared language and specs. The
            word "contract" isn't new. The word "branch" isn't new. What's new is making
            it native to an AI operating system instead of a process a human ties together.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "#666"}}>
            Small models don't have room to hold a backend, a frontend, a persistence
            layer, and a test suite in the same context window. They can hold one of those
            at a time. Swarm gives each one its own context, its own position, its own
            conversation. Coherence is handled by the contracts, not by cramming everything
            into one turn.
          </p>
          <p className="lp-section-sub lp-section-sub-wide" style={{color: "#666"}}>
            The result is compound work that would take a 200B model hours in one shot,
            done by many 27B models in parallel with validators keeping them aligned.
          </p>
          <div style={{marginTop: 32}}>
            <a className="lp-btn lp-btn-secondary" href="/code">See It In Code</a>
            <a className="lp-btn lp-btn-secondary" href="/seed" style={{marginLeft: 12}}>Back to the Seed</a>
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

export default SwarmPage;
