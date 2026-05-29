import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryAssign. Beat 2 of the five-beat moment cycle.
 *
 * Source. /reality/seed/present/beats/1-assign.js
 */
const FactoryAssign = () => {
  return (
    <article className="ns-doc">
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Beat 2</p>
        <h1 className="ns-doc-title">Assign</h1>
        <p className="ns-doc-lede">
          The scheduler picks an entry off the inbox and hands it to the
          stamper. The being's role is resolved. The moment has a frame.
        </p>
      </header>

      <section>
        <h2>What happens</h2>
        <p>
          The scheduler runs per-being. It looks at the highest-priority
          entry in the being's inbox and decides: yes, run this now. It
          loads the being row, resolves which role the moment will run under
          (the entry carries one or the being's default applies), and mints
          a fresh Act id.
        </p>
        <p>
          An Act is the row that frames one moment. It carries who acted, on
          whose behalf, what role they wore, when it opened, what message
          started it. The Act doesn't write to Mongo yet. It is planned,
          held in memory, threaded through the rest of the beats.
        </p>
      </section>

      <section>
        <h2>What's in the frame</h2>
        <p>
          The summonCtx, the moment's working context, is built here. It
          holds the actId, an empty ΔF (the set of facts the moment will
          stamp), the orientation (forward, half, inward, how the being
          wants to fold), and the calling identity.
        </p>
        <p>
          Every Fact emitted during this moment will join ΔF. None of them
          commit until the seal at the end.
        </p>
      </section>

      <section>
        <h2>Why it matters</h2>
        <p>
          Assign is where one being becomes the actor of one moment. Before
          assign, a being is potential. After assign, a specific moment is
          underway on their reel. If the cycle is the heartbeat, assign is
          the systole, the contraction that decides who acts next.
        </p>
      </section>

      <nav className="ns-doc-aside">
        <p>
          Previous. <Link to="/factory/intake" className="ns-inline-link">1. Intake</Link>
          . Next. <Link to="/factory/fold" className="ns-inline-link">3. Fold</Link>
          . The world is read into a face the being can act on.
        </p>
      </nav>
    </article>
  );
};

export default FactoryAssign;
