import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryBranches. The branch substrate.
 *
 * Conceptual hook first, technical payoff last. Nine sections that step
 * from "what if you could go back to any moment" up through the
 * substrate's per-branch reels, projections, and address grammar.
 *
 * Sources.
 *   /reality/seed/materials/branch/                  branch substrate
 *   /reality/seed/materials/projections.js           per-branch projection API
 *   /reality/seed/ibp/address.js                     # qualifier in grammar
 *   /reality/seed/present/beats/2-fold/foldEngine.js fold engine
 *   /reality/portal/3d-app/src/branch-bar.js         timeline + branch tree UI
 */
const FactoryBranches = () => {
  return (
    <article className="ns-doc">

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 1 — THE HOOK                                       */}
      {/* ────────────────────────────────────────────────────────── */}
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Substrate</p>
        <h1 className="ns-doc-title">Branches</h1>
        <p className="ns-doc-lede">
          What if you could go back to any moment, and continue forward
          differently? TreeOS treats reality as branchable. Past moments
          aren't gone. They're forkable.
        </p>
      </header>

      <section>
        <p>
          Most software treats the present as final. What happened,
          happened. What's now, is now. If you make a mistake, you fix
          it from here. You can't actually go back to where things went
          wrong and try again.
        </p>
        <p>
          TreeOS sees time differently. The world is a chain of moments.
          Every moment is recorded. And because everything is recorded,
          you can fold the world back to any moment, and from there
          choose a different path. The original keeps existing. The new
          path runs alongside it. Both are real.
        </p>
        <p>
          This isn't time travel as a feature. It's how the substrate
          works.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 2 — WHAT THIS LOOKS LIKE                            */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Three things this lets you do</h2>

        <h3>Undo, but for living systems.</h3>
        <p>
          You're running an experiment in a TreeOS world. Something
          breaks. In most systems you'd dig through logs to figure out
          what went wrong. In TreeOS, you scrub the timeline back to
          before the break, see exactly what the world looked like, and
          either fix what you can see, or branch a new path from that
          moment, leaving the broken version intact for forensics.
        </p>

        <h3>Try two ideas at once.</h3>
        <p>
          You're not sure whether to make a change. Instead of guessing,
          branch the world. In one branch, make the change. In the
          other, don't. Let both run for a while. Compare what happens.
          Then decide, based on what actually unfolded, which one you
          want to keep going.
        </p>

        <h3>Collaborative experimentation.</h3>
        <p>
          Multiple people working on the same world can each work in
          their own branch. No conflicts. No race conditions. When
          someone has something good, they can offer it back, and
          merging brings the work together with full visibility into
          what changed.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 3 — THE MENTAL MODEL                                */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>How branches actually work</h2>
        <p>
          Every TreeOS world has a <strong>main</strong>, the canonical
          reality where things are happening by default. When you
          connect to a world, you're in main unless you say otherwise.
        </p>
        <p>
          A <strong>branch</strong> is a parallel world that diverges
          from main at a chosen moment. Up to the branch point, the
          branch's history is identical to main's. After the branch
          point, the two run independently. Anything that happens in
          main doesn't affect the branch. Anything that happens in the
          branch doesn't affect main.
        </p>
        <p>
          Branches can themselves be branched. The result is a tree of
          realities, all sharing common ancestors, each living its own
          present. The first branch off canopy is{" "}
          <code>#0</code>. Children of <code>#0</code> are{" "}
          <code>#1</code>, <code>#2</code>, and so on. Children of{" "}
          <code>#1</code> are <code>#1a</code>, <code>#1b</code>.
          Children of <code>#1a</code> are <code>#1a1</code>,{" "}
          <code>#1a2</code>. Number and letter segments alternate;
          letters roll over <code>a..z</code>, <code>za..zz</code>,{" "}
          <code>zza..zzz</code>, so the 27th branch under canopy is{" "}
          <code>#1za</code>, the 27th sub-branch under <code>#22</code>{" "}
          is <code>#22zb</code>.
        </p>

        <h3>Names that move with the world</h3>
        <p>
          Those canonical paths are the substrate's truth: once{" "}
          <code>#7</code> is assigned, it forever names that exact
          branch. But people don't think in <code>#1a2</code>. They
          think in names: <em>main</em>, <em>prod</em>,{" "}
          <em>release-v2</em>. TreeOS layers a registry of mutable
          named pointers on top of the canonical paths.
        </p>
        <p>
          Every reality starts with a pointer named <code>main</code>{" "}
          that points at canonical <code>#0</code>. You can attach
          others as you go: <code>#prod</code> for the live world,{" "}
          <code>#feature-x</code> for an experiment, whatever fits the
          team. The names start with a lowercase letter, contain
          lowercase letters, digits, and single hyphens, and never
          collide with canonical paths (which always start with a
          digit). The parser tells them apart by structure.
        </p>
        <p>
          The reason for the indirection: when you finish an experiment
          on <code>#7</code> and merge it back, you probably want{" "}
          <em>main</em> to point at the result. Re-pointing{" "}
          <code>#main</code> takes one call. Every bookmark someone
          made to <code>treeos.ai/library</code> (no explicit branch)
          still works, because the default address follows the{" "}
          <code>#main</code> pointer wherever it goes. The canonical{" "}
          <code>#0</code> stays exactly where it always was, archived
          but reachable for historians.
        </p>
        <p>
          One thing pointers <em>don't</em> move:{" "}
          <code>#0</code> also anchors the reality's own bookkeeping,
          which the substrate keeps in a region called{" "}
          <strong>heaven</strong>. Heaven is a small set of seed
          spaces (<code>.beings</code>, <code>.spaces</code>,{" "}
          <code>.roles</code>, <code>.branches</code>,{" "}
          <code>.config</code>, and a few others) that hold what's true
          about the reality as a whole, not about any particular
          branch. The catalog of every being that exists, the
          definitions of every role, the branch tree itself, the
          pointer registry, the reality's settings, all of that.
        </p>
        <p>
          Heaven never branches. When you add a role, the new role is
          visible from <em>every</em> branch immediately, and stays
          visible no matter which branch you navigate into. When you
          edit the reality's config from <code>#1</code>, every branch
          sees the new config. That's the whole point: substrate
          metadata is reality-level structure, not branched content.
          Re-pointing <code>#main</code> at <code>#7</code> moves the
          default address that people <em>navigate</em> to, but heaven
          stays where it always was. Both bookmarks survive merges, the
          shared catalogs stay in one place, and the substrate's truth
          is always findable.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 4 — THE TIMELINE                                    */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>The timeline bar</h2>
        <p>
          Every TreeOS portal carries a timeline. By default it sits at
          "now", the current moment in whatever branch you're in. Drag
          it left and the entire world rewinds. Your being moves back to
          where it was, the space around you shifts to its earlier
          state, everything visible matches that past moment.
        </p>
        <p>
          The rewind is visual and immediate. You're not reading logs or
          replaying events. You're seeing the world as it was, from your
          being's perspective at that point. Past view is observer-only,
          a ghost view. The camera moves freely; no facts get stamped.
          Acting on the world while looking at the past would write the
          present, which would lie about what you observed.
        </p>
        <p>
          When you find a moment you want to fork from, click{" "}
          <em>branch here</em>. The substrate creates a new branch
          starting from that exact moment, and your portal switches into
          it. Now you can act forward from that past point, building a
          new history.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 5 — THE POWER                                       */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>What this makes possible</h2>

        <h3>Replay isn't archive.</h3>
        <p>
          Most systems treat history as logs, text you scrape to figure
          out what happened. In TreeOS, history is{" "}
          <em>live</em>. Drag the timeline back and the past is alive
          again, navigable, queryable, brandable. The chain of facts
          that produced "now" is the same substrate you're sitting in.
        </p>

        <h3>Branches run, they don't sit.</h3>
        <p>
          A TreeOS branch isn't a saved state. It's a parallel world
          running its own moments, accumulating its own facts, with its
          own beings acting their own behaviors. You can let a branch
          run for hours and come back to find a different present.
        </p>

        <h3>Identity persists across branches.</h3>
        <p>
          When you branch, you don't lose yourself. The same being you
          are in main exists in the new branch, with the same identity,
          the same lineage, just in a divergent world. Two versions of
          you, sharing history up to the fork, each living forward
          independently.
        </p>

        <h3>Merging is conversational.</h3>
        <p>
          When you want to combine branches, you don't deal with text
          diffs. You have a conversation with a merge mediator, an AI
          being whose job is to walk you through what changed in each
          branch and help you decide which to keep. The mediator stamps
          the chosen reconciliation as facts in a new merged branch.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 6 — WORKING WITH BRANCHES                          */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Working with branches</h2>
        <p>
          Branching is one operation. Living with the branches you've
          made is another. TreeOS has a small, deliberate set of
          lifecycle moves that cover the work between "I forked" and
          "I'm done."
        </p>

        <h3>Make a branch, give it a name</h3>
        <p>
          The standard move is one call:{" "}
          <em>create the branch and attach a pointer in the same
          step</em>. The substrate generates a canonical path (
          <code>#7</code>, <code>#1a</code>, whatever's next on the
          tree) and registers your chosen name (
          <code>#feature-x</code>,{" "}
          <code>#alpha-rebuild</code>) pointing at it. From that moment
          on, everyone on the team can navigate to{" "}
          <code>treeos.ai#feature-x/</code> instead of memorizing a
          canonical path.
        </p>
        <p>
          If you skip the pointer step, the branch still exists at its
          canonical path. You can attach a pointer later. The pointer
          registry is open: any team member with permission can add or
          re-point names.
        </p>

        <h3>Pause when you need to freeze, resume when ready</h3>
        <p>
          A paused branch stops accumulating. Its beings don't tick.
          Its world doesn't drift. You can rewind through it, inspect
          its state, navigate into it for read-only views, but no new
          facts land until you unpause. Pause is a stopgap when you
          need a branch to hold still while you think.
        </p>
        <p>
          Unpausing resumes from exactly where the pause caught it.
          There's no "loss of time" between the two; the world just
          waits.
        </p>

        <h3>Delete when you're done, undelete if you change your mind</h3>
        <p>
          Deleting a branch is a soft mark, not a purge. The branch's
          chain stays intact, its facts survive, historians can still
          read it via SEE. What the delete <em>does</em> do is take the
          branch out of the default navigation menu, refuse new writes,
          and stop its scheduler from ticking. It's gone from active
          use without being gone from the record.
        </p>
        <p>
          If you change your mind, undelete brings it back: navigation
          shows it again, writes are accepted again, the scheduler
          resumes. The same append-only doctrine that keeps facts
          immutable keeps deleted branches recoverable.
        </p>

        <h3>Merging two branches into a third</h3>
        <p>
          A merge doesn't change either source. It produces a third
          branch whose history is the common ancestor of the two, plus
          reconciliation facts that bring its state to whatever the
          operator chose. The originals stay untouched, forever
          findable as the branches they were.
        </p>
        <p>
          The substrate auto-detects conflicts (any reel that both
          sides touched divergently) and surfaces them as a catalog:{" "}
          <em>"this being's position is set differently on each side,"</em>{" "}
          <em>"this dancer is scheduled differently on each side,"</em>{" "}
          and so on. The merge-mediator role reads the catalog and
          walks the operator through it, one conflict at a time:
          present both sides, suggest a strategy, stamp the chosen
          reconciliation as a fact in the merged branch. It's a
          conversation, not a wall of diffs.
        </p>
        <p>
          The merge call also carries the operator's choices about the
          aftermath: <em>pause the sources, delete them, or leave them
          alone</em>; <em>re-point named pointers (like{" "}
          <code>#main</code>) at the merged branch</em>; <em>spin up the
          mediator now or come back later</em>. All in one substrate
          call, all surfaced clearly in the response so the dialog can
          confirm what landed.
        </p>

        <h3>Pointers move with the merge</h3>
        <p>
          The merge response carries the pointers that were attached
          to each source. If <code>#feature-x</code> pointed at one of
          the sources and you chose to move it to the merged branch,
          the next person to navigate to{" "}
          <code>treeos.ai#feature-x/</code> arrives in the result. If
          you chose to keep <code>#feature-x</code> pointing at the
          original source (now historical), the address still resolves
          there. Pointers are how people navigate. Canonical paths are
          how the substrate remembers. Both stay coherent.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 7 — THE COMPARISON                                  */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>If you know Git, you know half of this</h2>
        <p>
          The shape is recognizable. The leap is what each branch{" "}
          <em>contains</em>.
        </p>

        <div className="ns-grammar">
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">Git</code>
            <span className="ns-grammar-meaning">TreeOS</span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">
              Branches contain code (static)
            </code>
            <span className="ns-grammar-meaning">
              Branches contain reality (live, behavioral)
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">
              Merge resolves text conflicts
            </code>
            <span className="ns-grammar-meaning">
              Merge resolves state conflicts via conversation
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">
              Time travel through commit history
            </code>
            <span className="ns-grammar-meaning">
              Time travel through living world states
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">
              git checkout switches branches
            </code>
            <span className="ns-grammar-meaning">
              Portal <code>#</code> qualifier switches realities
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">
              Branch names are mutable refs (main, prod)
            </code>
            <span className="ns-grammar-meaning">
              Named pointers (<code>#main</code>, <code>#prod</code>)
              over immutable canonical paths
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">
              Branches sit until you work on them
            </code>
            <span className="ns-grammar-meaning">
              Branches run continuously, accumulating moments
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">
              git branch -d deletes the ref
            </code>
            <span className="ns-grammar-meaning">
              Delete marks the branch; the chain stays, undelete
              restores
            </span>
          </div>
          <div className="ns-grammar-row">
            <code className="ns-grammar-form">Identity is per-file</code>
            <span className="ns-grammar-meaning">
              Identity (<code>_id</code>) persists across all branches
            </span>
          </div>
        </div>

        <p className="ns-small">
          A Git branch is a label on a graph of commits. A TreeOS branch
          is a live world that happens to share history with its parent
          up to a chosen point. The protocols look similar; the
          substrates do not.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 7 — UNDER THE HOOD                                  */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Under the hood</h2>
        <p>
          Every aggregate in TreeOS, every being, every space, every
          matter, has its own reel. A reel is a hash-chained,
          append-only sequence of facts targeting that aggregate.
          Branches don't copy reels. A branch records its{" "}
          <strong>branch point</strong>, a per-reel seq cap on the
          parent's chain, and stores only the facts that happened{" "}
          <em>after</em> the divergence. When you read a being in a
          branch, the substrate walks the parent's reel up to the cap,
          then walks the branch's divergent facts forward. The chain
          stays unbroken. The hash chain follows the fork.
        </p>
        <p>
          Current state for each (aggregate, branch) lives in a{" "}
          <strong>projection</strong>, a cached document holding the
          result of folding all of that aggregate's facts in that
          branch. Projections are per-branch, so the same being can
          have different current states in main and in <code>#1</code>.
          A new branch starts with no projection slots; the first read
          of any aggregate in the new branch triggers a cold fold
          through the lineage that respects the branch point. After
          that the slot is cached; subsequent reads are single document
          lookups.
        </p>
        <p>
          Writes go to the branch the moment runs in. A fact emitted
          inside a moment on <code>#1</code> carries{" "}
          <code>branch: "1"</code>. The post-seal fold lands the new
          state on <code>#1</code>'s projection slot, never on main's.
          Reducers themselves are branch-blind, pure functions of{" "}
          <code>(state, fact)</code>. The substrate decides which slot
          to load and save. Branch identity never leaks into reducer
          logic.
        </p>
        <p>
          Queries that span aggregates apply the branch point filter
          honestly. A space's children on <code>#1</code> include
          children planted on <code>#1</code> after the branch{" "}
          <em>and</em> children that existed on main when the branch
          was created. They do not include children planted on main{" "}
          <em>after</em> the branch was made. The fold engine and the
          query helpers (<code>findByPosition</code>,{" "}
          <code>findByName</code>, <code>listSpaceChildren</code>) all
          consult the branch point per-aggregate.
        </p>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 8 — THE DOCTRINE                                    */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>The principles behind it</h2>

        <div className="ns-verb">
          <h3>Canonical paths are forever. Pointers move.</h3>
          <p className="ns-verb-line">
            Once <code>#7</code> is assigned to a branch, it forever
            names that branch. The substrate stores every branch's
            projections in the same shape; the structure is uniform.
            What changes is what people <em>call</em> a branch:{" "}
            <code>#main</code>, <code>#prod</code>,{" "}
            <code>#feature-x</code> are mutable labels in a registry
            that maps names to canonical paths. The default address
            (no <code>#</code>) follows the <code>#main</code>{" "}
            pointer, which itself is just an entry in that registry
            and can be re-pointed after any merge.
          </p>
        </div>

        <div className="ns-verb">
          <h3>Heaven holds what's true about the reality, not the branch.</h3>
          <p className="ns-verb-line">
            The substrate's own bookkeeping, the catalogs of beings,
            roles, branches, and config, lives in a region called
            heaven that doesn't branch. Add a role, edit reality
            config, register a pointer: the change is visible from
            every branch immediately. Branched content is the world
            beings inhabit. Heaven is the world's structure. The split
            is enforced at the substrate layer, so authoring can be
            done from any branch.
          </p>
        </div>

        <div className="ns-verb">
          <h3>The chain is the truth. Projections are caches.</h3>
          <p className="ns-verb-line">
            Every state in TreeOS is derived from the chain via
            deterministic functions. The cache is for speed. The truth
            is in the facts. A projection can be dropped at any time
            and re-folded from the facts; the substrate doesn't care.
          </p>
        </div>

        <div className="ns-verb">
          <h3>
            Branches are isolated. Cross-branch operations require
            explicit permission.
          </h3>
          <p className="ns-verb-line">
            Each branch is its own world. A SUMMON from a being on{" "}
            <code>#1</code> to a being on <code>#2</code> is doctrinally
            a cross-reality call and is refused until cross-branch
            portals are built. Within a single branch, every verb
            operates uniformly.
          </p>
        </div>

        <div className="ns-verb">
          <h3>Time and possibility are first-class primitives.</h3>
          <p className="ns-verb-line">
            Most systems collapse time and possibility into single
            timelines and single presents. TreeOS treats them as the
            substrate's primary dimensions. The fold engine accepts an{" "}
            <code>at</code> qualifier; the address grammar accepts a{" "}
            <code>#</code> qualifier; the descriptor builder threads
            both through every internal fold call so the whole place
            rewinds coherently.
          </p>
        </div>
      </section>

      {/* ────────────────────────────────────────────────────────── */}
      {/* SECTION 9 — CALL TO ACTION                                  */}
      {/* ────────────────────────────────────────────────────────── */}
      <section>
        <h2>Where to go from here</h2>
        <ul className="ns-list">
          <li>
            <strong>See the address grammar.</strong> The{" "}
            <code>#</code> qualifier sits on every IBP address and
            decides which branch a verb operates on.{" "}
            <Link to="/ibp" className="ns-inline-link">
              /ibp
            </Link>
            .
          </li>
          <li>
            <strong>See how a moment unfolds.</strong> The fold engine
            is the place reels meet projections. The whole five-beat
            cycle, including the branch-aware seal, lives at{" "}
            <Link to="/factory" className="ns-inline-link">
              /factory
            </Link>
            .
          </li>
          <li>
            <strong>See the fold beat in detail.</strong>{" "}
            <Link to="/factory/fold" className="ns-inline-link">
              /factory/fold
            </Link>{" "}
            shows how each aggregate's reel is folded into the face the
            being acts on.
          </li>
        </ul>
      </section>

      <nav className="ns-doc-aside">
        <p>
          Branches sit alongside the rest of the substrate at{" "}
          <Link to="/factory" className="ns-inline-link">
            /factory
          </Link>
          . They aren't a separate feature. They're how the kernel
          treats time and possibility from the bottom up.
        </p>
      </nav>
    </article>
  );
};

export default FactoryBranches;
