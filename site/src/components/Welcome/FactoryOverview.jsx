import { Link } from "react-router-dom";
import "./IbpPage.css";
import "./FactoryOverview.css";

/**
 * FactoryOverview. /factory landing. The five-beat cycle as a whole,
 * with one paragraph per beat and a link onward.
 *
 * Source. /reality/seed/FACTORY.md (the moment plus four-and-five-beat
 * stamper flow), translated to user friendly third person prose.
 */
const FactoryOverview = () => {
  return (
    <article className="ns-doc">
      <header className="ns-doc-header">
        <p className="ns-doc-eyebrow">The Factory</p>
        <h1 className="ns-doc-title">How a moment works</h1>
        <p className="ns-doc-lede">
          Every moment of every being walks the same five beats. The Factory
          is the engine that walks them.
        </p>
      </header>

      <section>
        <h2>Before the cycle: what is a being?</h2>
        <p>
          A moment belongs to a being. Before the five beats make sense,
          it helps to know what a being IS and what kinds of cognition
          drive one. Scripted, LLM, human, composite . the substrate
          treats them all the same.{" "}
          <Link to="/factory/being-types" className="ns-inline-link">
            Read Being types
          </Link>{" "}
          if any of those words need a footing.
        </p>
      </section>

      <section>
        <h2>The cycle</h2>
        <p>
          Time in TreeOS is made of moments. A moment is one being, one face
          of the world, one act. The Factory is what assembles a moment, runs
          it, and writes the result down.
        </p>
        <p>
          Five beats. They always happen in order, and they always repeat. A
          being lives by walking this loop again and again.
        </p>

        <ol className="ns-flow">
          <li className="ns-flow-step">
            <span className="ns-flow-num">1</span>
            <div>
              <h3>
                <Link to="/factory/intake" className="ns-inline-link">
                  Intake
                </Link>
              </h3>
              <p>
                A summon arrives. The being's inbox gains a new entry. Until
                the scheduler picks it up, nothing else happens.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">2</span>
            <div>
              <h3>
                <Link to="/factory/assign" className="ns-inline-link">
                  Assign
                </Link>
              </h3>
              <p>
                The scheduler picks the entry off the queue and hands it to
                the stamper. The being's role is resolved. An Act row is
                planned. The moment now has a frame.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">3</span>
            <div>
              <h3>
                <Link to="/factory/fold" className="ns-inline-link">
                  Fold
                </Link>
              </h3>
              <p>
                The reels the being depends on are folded. Every Fact behind
                them collapsed into a current view. This is what the being
                will see when it acts. Reads before writes.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">4</span>
            <div>
              <h3>
                <Link to="/factory/momentum" className="ns-inline-link">
                  Momentum
                </Link>
              </h3>
              <p>
                The being acts. Its role runs. New Facts accumulate, not yet
                committed. They are staged in the moment's ΔF, waiting for
                the seal.
              </p>
            </div>
          </li>

          <li className="ns-flow-step">
            <span className="ns-flow-num">5</span>
            <div>
              <h3>
                <Link to="/factory/stamped" className="ns-inline-link">
                  Stamped
                </Link>
              </h3>
              <p>
                The Act row materializes and every Fact in ΔF commits
                together, in one Mongo transaction. The reels grow. The past
                is now larger by one moment. The next intake can begin.
              </p>
            </div>
          </li>
        </ol>
      </section>

      <section>
        <h2>Why the cycle matters</h2>
        <p>
          A being is not a thing that holds state. A being is whoever stamped
          this reel of Facts. To know who a being is, fold their reel. To act
          AS a being, walk a moment through this cycle.
        </p>
        <p>
          That's the whole engine. The rest of the Factory tour unpacks each
          beat with examples.
        </p>
      </section>

      <section className="ns-doc-aside">
        <h2>If you came for the verbs</h2>
        <p>
          The four verbs (SEE / DO / SUMMON / BE) are how the outside world
          talks to TreeOS. Each one of them, when it arrives, kicks off a
          moment that walks the five beats above.{" "}
          <Link to="/ibp" className="ns-inline-link">
            Read about IBP
          </Link>{" "}
          for the protocol side.
        </p>
      </section>
    </article>
  );
};

export default FactoryOverview;
