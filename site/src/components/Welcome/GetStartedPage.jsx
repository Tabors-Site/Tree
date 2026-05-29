import SiteHeader from "./SiteHeader.jsx";
import SiteFooter from "./SiteFooter.jsx";
import "./GetStartedPage.css";

/**
 * GetStartedPage. Two paths into TreeOS, plus the short story on what
 * a reality is and how realities connect.
 *
 * The two cards are placeholders for now. The real flows behind them
 * (a self host kit, a portal join) come in a later pass.
 */
const GetStartedPage = () => {
  return (
    <div className="ns-page">
      <SiteHeader />

      <section className="ns-start">
        <div className="ns-start-inner">
          <p className="ns-doc-eyebrow">Get started</p>
          <h1 className="ns-start-title">Two ways in.</h1>
          <p className="ns-start-lede">
            Run your own reality, or step into someone else's. Either way you
            speak the same protocol when you get there.
          </p>

          <div className="ns-start-cards">
            <div className="ns-start-card">
              <span className="ns-start-card-kicker">Server</span>
              <h2 className="ns-start-card-title">Install Reality</h2>
              <p className="ns-start-card-body">
                Run your own reality. Your places, your data, your beings.
                Spin it up on your machine, shape its worlds, invite others
                in.
              </p>
              <span className="ns-start-card-cta">Coming soon</span>
            </div>

            <div className="ns-start-card">
              <span className="ns-start-card-kicker">Browser client</span>
              <h2 className="ns-start-card-title">Install Portal</h2>
              <p className="ns-start-card-body">
                Step into a reality someone else is running. Bring your
                identity, leave your facts where they belong.
              </p>
              <span className="ns-start-card-cta">Coming soon</span>
            </div>
          </div>
        </div>
      </section>

      <section className="ns-start-meta">
        <div className="ns-start-meta-inner">
          <h2 className="ns-start-meta-title">Sovereign, but connected.</h2>
          <p>
            Every reality is its own world with its own data. Nobody else hosts
            it, nobody else owns it. You decide what lives there, who can see
            it, and when it leaves.
          </p>
          <p>
            Inside, a reality is yours to shape. Custom beings and roles,
            custom extensions, custom rendering. Flat 2D for one space, full
            3D for another, text only for a third. Pick per reality, pick per
            space.
          </p>
          <p>
            Realities meet through IBP. The same four verbs every being
            already speaks become the bridge between worlds. Your beings can
            visit, theirs can visit back, and the address tells everyone
            whose ground they are standing on.
          </p>
          <p>
            Free. Open. Built so anyone can run their own and so every running
            one can find the others.
          </p>

          <div className="ns-start-req">
            <h3 className="ns-start-req-title">What you need to run one</h3>
            <ul className="ns-start-req-list">
              <li>Node.js</li>
              <li>MongoDB</li>
              <li>Any computer at or above a Raspberry Pi</li>
            </ul>
          </div>
        </div>
      </section>

      <SiteFooter />
    </div>
  );
};

export default GetStartedPage;
