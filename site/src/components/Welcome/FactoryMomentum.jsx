import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryMomentum. Beat 4 of the five-beat moment cycle.
 *
 * Source. /reality/seed/present/beats/3-momentum.js.
 * Background. /reality/philosophy/STAMPER.md.
 */
const FactoryMomentum = () => {
  return (
    <article className="ns-doc">
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Beat 4</p>
        <h1 className="ns-doc-title">Momentum</h1>
        <p className="ns-doc-lede">
          The being acts. Its role runs against the face it was given. New
          Facts accumulate in ΔF, not yet committed.
        </p>
      </header>

      <section>
        <h2>What happens</h2>
        <p>
          The being's role is whatever logic decides what to do next. For an
          LLM being, the role assembles a prompt from the fold, calls the
          model, parses the response into tool calls, and runs each one. For
          a scripted being, the role is a function that reads the fold and
          calls the verbs directly. For a human being, the role is a no op.
          The human acts out of band, through their own transport, and the
          system trusts the transport act that arrives.
        </p>
        <p>
          Whatever the cognition, the outcome is the same shape: a stream of
          new Facts pushed onto ΔF. A move stamps a coord change. A summon
          stamps an inbox entry on someone else's reel. A creation stamps a
          new aggregate's first Fact. The role decides; the kernel emits.
        </p>
      </section>

      <section>
        <h2>Facts staged, not committed</h2>
        <p>
          During momentum, every Fact emitted joins ΔF, the moment's
          delta fact set. Nothing has hit Mongo yet. The being can act on
          many aggregates inside one moment, and the staging buffer holds
          them all together until the seal.
        </p>
        <p>
          This is why a moment is atomic. If the role throws partway
          through, ΔF is discarded. If the seal runs, every Fact in ΔF
          commits together in one transaction. No half state, ever.
        </p>
      </section>

      <section>
        <h2>What momentum produces</h2>
        <p>
          A cognition result. Success means the role finished and ΔF is
          ready to seal. Failure means the role threw or returned a problem;
          the moment is released, ΔF is dropped, the Act row is never
          written. From the outside the moment never happened, even though
          the inbox entry that triggered it did.
        </p>
      </section>

      <nav className="ns-doc-aside">
        <p>
          Previous. <Link to="/factory/fold" className="ns-inline-link">3. Fold</Link>
          . Next. <Link to="/factory/stamped" className="ns-inline-link">5. Stamped</Link>
          . The seal commits everything.
        </p>
      </nav>
    </article>
  );
};

export default FactoryMomentum;
