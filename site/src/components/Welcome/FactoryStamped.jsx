import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryStamped. Beat 5 of the five-beat moment cycle.
 *
 * Source. /reality/seed/present/beats/4-stamped.js, sealAct, sealFacts.
 * Background. /reality/philosophy/STAMPER.md.
 */
const FactoryStamped = () => {
  return (
    <article className="ns-doc">
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Beat 5</p>
        <h1 className="ns-doc-title">Stamped</h1>
        <p className="ns-doc-lede">
          The Act row materializes. Every Fact in ΔF commits together. The
          reels grow. The past is now larger by one moment.
        </p>
      </header>

      <section>
        <h2>What happens</h2>
        <p>
          The seal opens a Mongo transaction. The planned Act row writes.
          Every Fact in ΔF writes. Grouped by reel, in seq order, under
          per reel append locks acquired in a deadlock free order. Hash
          chains link each new Fact to the one before it on its reel so
          tampering is detectable. Eager folds run after commit so the
          projection caches catch up.
        </p>
        <p>
          One transaction. Either the whole moment lands, or none of it
          does. A crash mid-seal rolls back. There is no half-stamped state
          anywhere in the system.
        </p>
      </section>

      <section>
        <h2>What the seal guarantees</h2>
        <p>
          When the seal returns ok, three things are true. The Act row
          exists with the moment's start and end messages. Every Fact in ΔF
          is on its reel with a seq, a prev-hash, and a self-hash. The
          projection caches have caught up (or will soon, self-healing on
          the next fold).
        </p>
        <p>
          Any reader from this point on, anywhere in the system, sees the
          new state. The fold-engine's compare-and-set on the projection
          marker ensures concurrent re-folds don't regress.
        </p>
      </section>

      <section>
        <h2>And the cycle repeats</h2>
        <p>
          The moment is over. The being's actId is released. The scheduler
          looks at the next inbox entry. Maybe one that arrived during the
          last moment, maybe a fresh one. The cycle starts again at{" "}
          <Link to="/factory/intake" className="ns-inline-link">intake</Link>.
        </p>
        <p>
          A being's entire existence is this loop. Walk it forward enough
          times and you have a life.
        </p>
      </section>

      <nav className="ns-doc-aside">
        <p>
          Previous. <Link to="/factory/momentum" className="ns-inline-link">4. Momentum</Link>
          . Back to{" "}
          <Link to="/factory" className="ns-inline-link">the cycle overview</Link>.
        </p>
      </nav>
    </article>
  );
};

export default FactoryStamped;
