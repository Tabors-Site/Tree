import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryFold. Beat 3 of the five-beat moment cycle.
 *
 * Source. /reality/seed/present/beats/2-fold/foldEngine.js and foldPlace.js.
 * Background. /reality/philosophy/FOLD.md.
 */
const FactoryFold = () => {
  return (
    <article className="ns-doc">
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Beat 3</p>
        <h1 className="ns-doc-title">Fold</h1>
        <p className="ns-doc-lede">
          The reels the being needs are folded. Every Fact behind them
          collapsed into a current view. This is what the being sees.
        </p>
      </header>

      <section>
        <h2>What happens</h2>
        <p>
          Every aggregate in TreeOS, every being, every space, every
          matter, has its own reel of Facts. To know what a space currently
          looks like, you don't read a stored row. You take its reel and
          fold it. Start from an empty state, apply each Fact in seq order,
          end with the current state.
        </p>
        <p>
          The fold engine does this fast. Each aggregate has a projection
          row that caches the last fold result; the next fold only reads
          Facts past the last marker, applies them, advances the marker.
          Hot path is one cache read.
        </p>
      </section>

      <section>
        <h2>What a being folds</h2>
        <p>
          A being folds its own self plus the space it stands in plus every
          occupant at that space. Beings, matter, child spaces. Reach is
          one hop. The being doesn't deep fold neighboring trees. If it
          moves into one, the next moment folds those reels too.
        </p>
        <p>
          Orientation decides which axis of the fold the being walks.{" "}
          <em>Forward</em> looks at the world. <em>Inward</em> turns the
          fold on the being's own act chain instead. <em>Half</em> does
          both. Forward face plus a recalled set of past acts that touched
          the entities currently changing.
        </p>
      </section>

      <section>
        <h2>Why reads happen here</h2>
        <p>
          Reads-before-writes. The being acts (beat 4) only on what the
          fold returned (beat 3). Even if other beings are mutating the
          same space in parallel, this being's moment is decided by the
          face that was assembled here.
        </p>
        <p>
          When two beings act on the same space at the same time, their
          new Facts land separately on the space's reel and the bump rules
          in the reducer adjudicate at fold time later. Nothing is locked.
          Nothing waits on anyone else's thinking.
        </p>
      </section>

      <nav className="ns-doc-aside">
        <p>
          Previous. <Link to="/factory/assign" className="ns-inline-link">2. Assign</Link>
          . Next. <Link to="/factory/momentum" className="ns-inline-link">4. Momentum</Link>
          . The being acts on the face it was given.
        </p>
      </nav>
    </article>
  );
};

export default FactoryFold;
