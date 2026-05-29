import { Link } from "react-router-dom";
import SiteHeader from "./SiteHeader.jsx";
import SiteFooter from "./SiteFooter.jsx";
import "./NewLandingPage.css";

/**
 * NewLandingPage. The 2026 landing.
 *
 * Hero with two big buttons [IBP] [Factory], then a scrollable
 * "What is this?" section below as the gentle intro.
 *
 * Copy here is intentionally short. The deep tours live at /ibp and
 * /factory. Old long-form pages remain reachable under /old/*.
 */
const NewLandingPage = () => {
  return (
    <div className="ns-page">
      <SiteHeader />

      <section className="ns-hero">
        <div className="ns-hero-inner">
          <img src="/tree.png" alt="" className="ns-hero-logo" />
          <h1 className="ns-hero-title">TreeOS</h1>
          <p className="ns-hero-tag">
            An operating system for AI agents. Beings, places, and the moments
            that bind them.
          </p>
          <div className="ns-hero-buttons">
            <Link to="/ibp" className="ns-btn ns-btn--primary">
              <span className="ns-btn-label">IBP</span>
              <span className="ns-btn-sub">The protocol</span>
            </Link>
            <Link to="/factory" className="ns-btn ns-btn--primary">
              <span className="ns-btn-label">Factory</span>
              <span className="ns-btn-sub">How a moment works</span>
            </Link>
            <Link to="/start" className="ns-btn ns-btn--primary">
              <span className="ns-btn-label">Get started</span>
              <span className="ns-btn-sub">Make or join a reality</span>
            </Link>
          </div>
          <div className="ns-hero-scrollhint" aria-hidden="true">
            What is this? <span className="ns-hero-arrow">↓</span>
          </div>
        </div>
      </section>

      <section className="ns-what" id="what">
        <div className="ns-what-inner">
          <h2 className="ns-what-title">What is this?</h2>

          <p>
            TreeOS is a runtime for beings. Humans, AI agents, scripted
            characters, whatever shape of mind a system needs. Every being
            lives somewhere in a tree of positions, and every act it performs
            is written into a fact chain that the rest of the system reads
            from.
          </p>

          <p>
            Nothing is stored as a final value. Everything is a fact, and the
            world a being sees is the fold of every fact behind it. Move a
            being, change a quality, summon another being to talk. All of it
            becomes one more fact on a reel, and the next read folds that
            reel into a current view.
          </p>

          <p>
            There are two surfaces to know about.{" "}
            <Link to="/ibp" className="ns-inline-link">IBP</Link> is the
            protocol you speak to make anything happen. Four verbs (SEE, DO,
            SUMMON, BE) over addresses that point at beings and positions.{" "}
            <Link to="/factory" className="ns-inline-link">Factory</Link> is
            the engine inside. The five beats every moment of every being
            walks through, from intake to stamped.
          </p>

        </div>
      </section>

      <SiteFooter />
    </div>
  );
};

export default NewLandingPage;
