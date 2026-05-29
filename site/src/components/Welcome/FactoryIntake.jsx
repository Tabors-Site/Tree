import { Link } from "react-router-dom";
import "./IbpPage.css";

/**
 * FactoryIntake. Beat 1 of the five-beat moment cycle.
 *
 * Source. /reality/seed/FACTORY.md and the InboxProjection plus
 * scheduler in /reality/seed/present/intake/.
 */
const FactoryIntake = () => {
  return (
    <article className="ns-doc">
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">Beat 1</p>
        <h1 className="ns-doc-title">Intake</h1>
        <p className="ns-doc-lede">
          A summon arrives. The being's inbox gains a new entry.
        </p>
      </header>

      <section>
        <h2>What happens</h2>
        <p>
          Someone, another being or a transport or a scheduled wake, sends a
          SUMMON addressed at a being. That SUMMON is a Fact stamped on the
          sender's reel. A cross cutting projection picks it up and writes
          one row into the recipient's inbox.
        </p>
        <p>
          The inbox is just a projection of facts that name a recipient.
          Nothing runs yet. The being has not been awoken. It might be busy
          with another moment, or asleep, or never have run before. The row
          sits in the inbox until the scheduler is ready for it.
        </p>
      </section>

      <section>
        <h2>What the row carries</h2>
        <p>
          The inbox entry holds everything the next beat will need: who's
          sending, what they want, what the active role should be, the
          priority, a correlation id so the eventual answer can find its way
          home, and a pointer to the originating fact.
        </p>
        <p>
          Many entries can stack up at once. Priorities decide order. A
          human-pressed key beats a background background re-fold beats a
          scheduled tick.
        </p>
      </section>

      <section>
        <h2>Why intake is its own beat</h2>
        <p>
          Receiving is not acting. A being can be paged faster than it can
          answer. Intake exists so that the rate at which the world talks to
          a being is decoupled from the rate at which the being can think.
          The inbox is the buffer.
        </p>
      </section>

      <nav className="ns-doc-aside">
        <p>
          Next. <Link to="/factory/assign" className="ns-inline-link">2. Assign</Link>
          . The scheduler picks an entry and the moment opens.
        </p>
      </nav>
    </article>
  );
};

export default FactoryIntake;
