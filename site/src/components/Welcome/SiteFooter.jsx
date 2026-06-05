import { Link } from "react-router-dom";
import "./SiteFooter.css";

/**
 * SiteFooter. Small footer for the new site. Brand on the left, the
 * primary nav in the middle, the License link (to the /license page) on
 * the right; a quiet credit line sits underneath.
 */
const SiteFooter = () => {
  return (
    <footer className="ns-footer">
      <div className="ns-footer-inner">
        <div className="ns-footer-row">
          <Link to="/" className="ns-footer-brand">TreeOS</Link>
          <nav className="ns-footer-nav" aria-label="Footer">
            <Link to="/ibp" className="ns-footer-link">IBP</Link>
            <Link to="/portal" className="ns-footer-link">Portal</Link>
            <Link to="/factory" className="ns-footer-link">Factory</Link>
            <Link to="/start" className="ns-footer-link">Get started</Link>
            <Link
              to="/license"
              className="ns-footer-link ns-footer-link--muted"
            >
              License
            </Link>
          </nav>
        </div>
        <div className="ns-footer-tag">
          TreeOS . AGPL-3.0 with commercial option . Created by{" "}
          <a
            href="https://tabors.site"
            className="ns-footer-credit"
            target="_blank"
            rel="noreferrer"
          >
            Tabor Holly
          </a>
        </div>
      </div>
    </footer>
  );
};

export default SiteFooter;
