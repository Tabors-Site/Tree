import { Link, NavLink } from "react-router-dom";
import "./SiteHeader.css";

/**
 * SiteHeader. Top bar for the new site (NewLandingPage, IbpPage,
 * FactoryLayout). Logo on the left, nav links on the right.
 *
 * The legacy site under /old/* renders its own headers via the old
 * components; this file is for the new surface only.
 */
const SiteHeader = () => {
  return (
    <header className="ns-header">
      <div className="ns-header-inner">
        <Link to="/" className="ns-header-brand" aria-label="TreeOS home">
          <img src="/tree.png" alt="" className="ns-header-logo" />
          <span className="ns-header-name">TreeOS</span>
        </Link>
        <nav className="ns-header-nav" aria-label="Primary">
          <NavLink
            to="/ibp"
            className={({ isActive }) =>
              isActive ? "ns-header-link ns-header-link--active" : "ns-header-link"
            }
          >
            IBP
          </NavLink>
          <NavLink
            to="/factory"
            className={({ isActive }) =>
              isActive ? "ns-header-link ns-header-link--active" : "ns-header-link"
            }
          >
            Factory
          </NavLink>
          <NavLink
            to="/start"
            className={({ isActive }) =>
              isActive ? "ns-header-link ns-header-link--active" : "ns-header-link"
            }
          >
            Get started
          </NavLink>
        </nav>
      </div>
    </header>
  );
};

export default SiteHeader;
