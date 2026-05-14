import "./LandingPage.css";
import "./Governing.css";
import Particles from "./Particles.jsx";

// WorkerPage. /governing/rulership/worker
//
// The role at the leaves where coordination meets domain. The only role
// in Rulership that produces artifacts rather than coordinating. This
// page also doubles as the bridge to future workspace specific docs:
// it establishes the Worker as the general primitive and workspace
// extensions as the specialization site.

const WorkerPage = () => {
  return (
    <div className="lp lp-gov">

      {/* HERO */}
      <section className="lp-hero">
        <Particles count={25} />
        <div className="lp-hero-inner">
          <div className="lp-tree-icon">🔨</div>
          <h1 className="lp-title">The Worker</h1>
          <p className="lp-subtitle">The hand of the work</p>
          <p className="lp-tagline">
            Where the other four roles in Rulership coordinate, judge,
            ratify, and watch, the Worker is the role that actually
            produces. Ruler decides. Planner drafts. Contractor binds.
            Foreman manages. None of them write a file, compose a
            paragraph, or take a civic action. The Worker does. They
            execute leaf work under the contracts in force, and they're
            the only role whose output is artifact rather than
            coordination.
          </p>
          <div className="lp-hero-ctas lp-hero-ctas-sub">
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership">↑ Rulership</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/ruler">Ruler</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/planner">Planner</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/contractor">Contractor</a>
            <a className="lp-btn lp-btn-secondary" href="/governing/rulership/foreman">Foreman</a>
          </div>
        </div>
      </section>

      {/* THE PRODUCING ROLE */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">The producing role</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Every other role in TreeOS is shaped around coordination.
            Making decisions about decomposition, scope, flow,
            ratification. The Worker is shaped around production. The
            Worker is the role where the abstract substrate meets
            concrete output. A file lands on disk. A chapter gets
            written. A civic agreement gets drafted. Until the Worker
            runs, nothing has actually been built.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            This is also the role where TreeOS's general substrate
            becomes domain specific. Ruler, Planner, Contractor, Foreman
            are all domain neutral. Same primitive whether the work is
            code, prose, or civic coordination. The Worker is where
            workspace extensions specialize the substrate for their
            domain. The general role is the same. The tools, validators,
            and outputs are domain specific.
          </p>
        </div>
      </section>

      {/* A SPECIALIZED ROLE */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">A specialized role</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Worker has a base mode that any workspace can extend.
            The base mode handles the role's universal mechanics. Read
            the briefing, read the contracts in force, read the local
            tree state, produce the output, emit completion. What gets
            specialized per workspace.
          </p>
          <div className="lp-cards">
            <div className="lp-card lp-card-sm">
              <h4>Tools</h4>
              <p>
                What the Worker can actually do. code workspace adds
                workspace-add-file, workspace-edit-file, package-add-dependency,
                run-test. book workspace adds chapter-write, character-define,
                timeline-update. civilization adds proposal-draft,
                agreement-publish, jurisdiction-define.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Validators</h4>
              <p>
                What counts as conformance to ratified contracts. code
                workspace validates syntax, type signatures, contract
                conformance, smoke tests. book workspace validates voice
                continuity, character consistency, timeline coherence.
                civilization validates jurisdictional authority,
                agreement legibility, precedent fit.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Output shape</h4>
              <p>
                What the Worker actually emits. code workspace emits
                files. book workspace emits chapters and metadata.
                civilization emits documents and recorded agreements.
                The shape is whatever the domain produces.
              </p>
            </div>
            <div className="lp-card lp-card-sm">
              <h4>Briefing language</h4>
              <p>
                How the Worker is told what to build. code workspace
                briefings reference contracts by name and specify file
                paths. book workspace briefings reference character arcs
                and chapter positions. civilization briefings reference
                jurisdictions and prior agreements.
              </p>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24}}>
            The other four roles see none of this specialization. A
            Planner drafting a code project produces the same shape of
            plan as a Planner drafting a book. The specialization lives
            at the leaves, where work meets domain.
          </p>
        </div>
      </section>

      {/* THE FOUR TYPES */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Four cognitive shapes</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Worker is typed. Not by domain. By the cognitive shape
            of the work. Bringing something new into existence reads
            different from improving something that already exists,
            which reads different from judging an artifact without
            modifying it, which reads different from tying sibling
            outputs together. These are four distinct mental moves, and
            mixing them inside one generic Worker flattens distinctions
            the rest of the architecture should preserve.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The Planner picks a type per leaf step. The Foreman sees the
            type on every frame. Pass 3 reputation reads how often this
            scope handled each type and how well. The type is an
            addressable unit of judgment, not an implementation detail.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>Build</h3>
              <p style={{fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 8}}>
                Default. The reference shape.
              </p>
              <p>
                Bring something new into existence at this scope. The
                spec describes what doesn't yet exist; the Worker makes
                it exist correctly the first time. Smallest correct
                thing first. No pre-building for the future. Most fresh
                plan leaves are builds.
              </p>
            </div>
            <div className="lp-card">
              <h3>Refine</h3>
              <p style={{fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 8}}>
                Read first. Write second. Minimum surface.
              </p>
              <p>
                Improve an existing artifact. The input shape constrains
                the output. The Worker reads the file, judges what
                works, and makes the smallest correct change. A refine
                that throws everything away isn't a refine, it's a
                build pretending. Preserve unrelated behavior.
              </p>
            </div>
            <div className="lp-card">
              <h3>Review</h3>
              <p style={{fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 8}}>
                Read only. Findings, not rewrites.
              </p>
              <p>
                Judge an artifact and produce structured findings
                without modifying it. Read only discipline. Output is
                organized by severity with line level evidence and
                citations to specific contracts. Reviews surface what
                single scope writers miss at the seam.
              </p>
            </div>
            <div className="lp-card">
              <h3>Integrate</h3>
              <p style={{fontSize: 13, color: "rgba(255,255,255,0.55)", marginBottom: 8}}>
                Reconcile. Don't reach into siblings.
              </p>
              <p>
                Tie sibling sub Ruler outputs into a coherent surface at
                this scope. Reads the siblings first. Writes only top
                level integration files. Uses contracted identifiers
                verbatim. If two siblings conflict in unbound vocabulary,
                surface that rather than pick a winner.
              </p>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 32}}>
            Each type has its own base mode in governing
            (tree:governing-worker-build, refine, review, integrate)
            with a system prompt tuned to the cognitive shape. Workspace
            extensions can register their own per type variants. Tools
            and validators inject through spatial scoping; the type
            decides the prompt body.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            Why typed instead of generic. A generic Worker prompt is an
            average of four distinct mental moves, which means none of
            them are sharp. A Build Worker hears "smallest correct
            thing"; a Refine Worker hears "read before writing"; a
            Review Worker hears "do not modify"; an Integrate Worker
            hears "reconcile, don't recreate." Typed prompts make the
            judgment surface explicit. The Foreman can read "refine
            failed" or "integrate failed" and recognize the failure
            shape without having to infer it. Reputation can score
            how this scope handles each kind of work, separately.
          </p>
        </div>
      </section>

      {/* PHILOSOPHY */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Philosophy</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Three principles shape every Worker run.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>Production within ratified bounds</h3>
              <p>
                The Worker doesn't decide what to build. The Ruler
                ratified that. The Worker doesn't decide what to share.
                The Contractor committed that. The Worker builds within
                those bounds. Their judgment is bounded to <em>how</em>{" "}
                to produce something that conforms to the contracts and
                serves the plan, not <em>whether</em> to do this work or{" "}
                <em>what</em> to do at all.
              </p>
            </div>
            <div className="lp-card">
              <h3>Domain expertise lives here</h3>
              <p>
                The base Worker primitive doesn't know what good code
                looks like, what good prose feels like, or what well
                formed civic agreements require. That knowledge is in
                the workspace's specialized tools and validators. The
                Worker is where domain specific expertise enters the
                architecture. Everywhere else it's deliberately absent.
              </p>
            </div>
            <div className="lp-card">
              <h3>Output speaks for itself</h3>
              <p>
                The Worker doesn't synthesize for the user. The Ruler
                does that. The Worker doesn't explain its choices in
                prose. The artifact is the explanation. A file that
                compiles, a chapter that flows, an agreement that holds.
                The Worker's value is what they leave behind, not what
                they say about it.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* WHAT THEY DO */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container">
          <h2 className="lp-section-title">What the Worker does</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            One job, four phases, then exit.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Read the briefing</h4>
                <p>
                  The Worker is invoked at a leaf step in a plan with a
                  briefing from the Ruler. What specifically to build,
                  what scope, what constraints from the plan and parent
                  context.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Read the contracts in force</h4>
                <p>
                  The Worker reads every contract that applies at this
                  scope. The canonical names, the wire shapes, the
                  storage keys, the agreed upon terms. Their output must
                  conform.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Produce the output</h4>
                <p>
                  Using the workspace's specialized tools, the Worker
                  writes the file, drafts the chapter, files the
                  agreement. This is where the actual work happens.
                </p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Emit completion</h4>
                <p>
                  The Worker signals what was produced and exits.
                  Validators run. If conformance fails, the Foreman
                  handles retry or escalation.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* WORKSPACES SPECIALIZING THE WORKER */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">Workspaces specializing the Worker</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Three current and forthcoming workspace extensions show what
            specialization looks like. The architecture is shaped to
            support all three (and others) through the same Worker
            specialization pattern. Implementation state varies. Be
            aware of which is what.
          </p>
          <div className="lp-cards">
            <div className="lp-card">
              <h3>💻 code workspace</h3>
              <p style={{color: "#4ade80", fontSize: "0.85em", fontWeight: 600, marginBottom: 8}}>
                Fully built today.
              </p>
              <p>
                <strong>Tools.</strong> workspace-add-file,
                workspace-edit-file, workspace-delete-file,
                package-add-dependency, run-test, run-build,
                get-file-content.
              </p>
              <p>
                <strong>Validators.</strong> Syntax (does it parse?).
                Type signatures (do they match contract interfaces?).
                Import conformance (do you use canonical names from the
                contracts?). Smoke tests (does the file at least load?).
                Behavioral tests if specified.
              </p>
              <p>
                <strong>Output.</strong> Files in the project filesystem
                with auto sync to working tree.
              </p>
              <p>
                <strong>Briefing language.</strong> References contracts
                by name, specifies file paths and structure.
              </p>
            </div>
            <div className="lp-card">
              <h3>📖 book workspace</h3>
              <p style={{color: "#facc15", fontSize: "0.85em", fontWeight: 600, marginBottom: 8}}>
                Partially built today.
              </p>
              <p>
                <strong>Tools.</strong> chapter-write, chapter-revise,
                character-define, character-update, timeline-update,
                terminology-add, scene-draft, beat-record.
              </p>
              <p>
                <strong>Validators.</strong> Voice continuity (does this
                match the established narrator?). Character consistency
                (does this character act like themselves?). Timeline
                coherence (does the chronology hold?). Vocabulary
                conformance (are the canonical terms used consistently?).
              </p>
              <p>
                <strong>Output.</strong> Chapter prose with associated
                metadata (character beats, timeline updates, terminology
                references).
              </p>
              <p>
                <strong>Briefing language.</strong> References character
                arcs, story beats, and prior chapter positions.
              </p>
            </div>
            <div className="lp-card">
              <h3>🏛️ civilization</h3>
              <p style={{color: "#888", fontSize: "0.85em", fontWeight: 600, marginBottom: 8}}>
                Forthcoming. Speculative example.
              </p>
              <p>
                <strong>Tools.</strong> proposal-draft, agreement-publish,
                jurisdiction-define, dispute-file, precedent-cite,
                vote-record, ratification-confirm.
              </p>
              <p>
                <strong>Validators.</strong> Jurisdictional authority
                (does this scope have authority over what's proposed?).
                Agreement legibility (can affected parties understand
                and verify?). Precedent fit (does this contradict prior
                agreements at this jurisdiction?). Participant standing
                (do the parties have standing to commit?).
              </p>
              <p>
                <strong>Output.</strong> Ratified agreements, proposals,
                recorded votes, dispute filings.
              </p>
              <p>
                <strong>Briefing language.</strong> References
                jurisdictions, prior agreements, and standing parties.
              </p>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24}}>
            Each workspace's Worker is a specialization of the same base
            primitive. The role's architecture (bounded judgment,
            contract conformance, validator driven correctness) stays
            uniform. What varies is the domain content the Worker
            produces and the domain specific tools they use to produce
            it.
          </p>
        </div>
      </section>

      {/* BASE MODE IS REAL */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">The base mode is real</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The Worker base mode (<code>tree:governing-worker</code>) is
            functional standalone, even without workspace specialization.
            It can read briefings, read contracts, emit completion. What
            it can't do is produce domain artifacts. That's what
            specialization adds. A workspace extension declares its
            Worker variant by registering tools and validators that
            extend the base. The substrate provides the structure. The
            workspace provides the substance.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            This is what makes TreeOS a general substrate. A new domain
            can be added by writing a workspace extension that
            specializes Worker for its specific output shape. The Ruler
            primitive doesn't need updating. The Planner primitive
            doesn't need updating. The Contractor primitive doesn't
            need updating. The Foreman primitive doesn't need updating.
            Only the Worker. The role at the leaves where work meets
            domain.
          </p>
        </div>
      </section>

      {/* EXAMPLE RUN */}
      <section className="lp-section">
        <div className="lp-container">
          <h2 className="lp-section-title">An example run</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            Continuing the Flappy Bird Battle Royale example. Contracts
            ratified, dispatch fired, sub Rulers running. Inside the{" "}
            <code>core</code> sub Ruler's plan, step 1 is a leaf.
            "Create render.js with the canvas rendering loop, using the
            contracts event:tick and dom:gameCanvas." Here's what the
            Worker does.
          </p>
          <div className="lp-steps">
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#4ade80", color: "#000"}}>1</div>
              <div className="lp-step-content">
                <h4>Reads the briefing</h4>
                <p>File path (core/render.js), purpose (canvas rendering loop), contracts to honor (event:tick listener, dom:gameCanvas reference).</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#60a5fa", color: "#000"}}>2</div>
              <div className="lp-step-content">
                <h4>Reads the contracts in force</h4>
                <p>tick fires every game frame. gameCanvas is the DOM id for the canvas element.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#f59e0b", color: "#000"}}>3</div>
              <div className="lp-step-content">
                <h4>Produces the file</h4>
                <p>Imports the tick event. Queries gameCanvas. Sets up the rendering loop using requestAnimationFrame. Attaches the listener. Defines the render function with the entity rendering hooks left abstract for the entities branch to fill in.</p>
              </div>
            </div>
            <div className="lp-step">
              <div className="lp-step-num" style={{background: "#a855f7", color: "#000"}}>4</div>
              <div className="lp-step-content">
                <h4>Emits completion</h4>
                <p><code>workspace-add-file</code> with the contents. Auto sync schedules. Validators run. Syntax passes. Contract conformance passes (uses canonical names). Smoke test passes (file loads).</p>
              </div>
            </div>
          </div>
          <p className="lp-section-sub lp-section-sub-wide" style={{marginTop: 24, color: "#888", fontSize: "0.92rem"}}>
            One LLM call, one artifact. The Worker exits. The next
            step's Worker takes over.
          </p>
        </div>
      </section>

      {/* WHY THE WORKER IS THE BOTTOM */}
      <section className="lp-section lp-section-alt">
        <div className="lp-container" style={{maxWidth: 760}}>
          <h2 className="lp-section-title">Why the Worker is the bottom</h2>
          <p className="lp-section-sub lp-section-sub-wide">
            The recursion ends here. Workers don't promote to Rulers.
            Workers don't dispatch sub branches. If a Worker discovers
            the leaf work was actually compound (too big to handle as
            one production), they emit branches via <code>[[BRANCHES]]</code>{" "}
            and their own node retroactively promotes to Ruler. But
            that's a different lifecycle event. The Worker that
            discovered the compound nature has exited. A new sub Ruler
            takes over with its own Planner, Contractor, dispatch.
          </p>
          <p className="lp-section-sub lp-section-sub-wide">
            The Worker is the bottom of the recursion in the same sense
            that leaves are the bottom of a tree. The work happens
            here. Everything else is structure.
          </p>
        </div>
      </section>

      {/* CLOSING CALLBACK */}
      <section className="lp-section">
        <div className="lp-container" style={{maxWidth: 760, textAlign: "center"}}>
          <p className="lp-section-sub lp-section-sub-wide" style={{fontSize: "1.1rem", color: "#e5e5e5"}}>
            The hand of the work produces what the architecture
            coordinated toward. The other roles arrange the conditions.
            The Worker makes them concrete. When the artifact lands,
            the work is real.
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

export default WorkerPage;
