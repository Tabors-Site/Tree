import { Link } from "react-router-dom";
import "./SiteFooter.css";

/**
 * SiteFooter. Small footer for the new site. Brand on the left, the
 * primary nav in the middle, license link on the right; a quiet credit
 * line sits underneath.
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
            <a
              href="https://github.com/taborgreat/create-treeos/blob/main/template/seed/LICENSE"
              className="ns-footer-link ns-footer-link--muted"
              target="_blank"
              rel="noreferrer"
            >
              AGPL-3.0 License
            </a>
          </nav>
        </div>
        <div className="ns-footer-tag">
          TreeOS . AGPL-3.0 . Created by{" "}
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
