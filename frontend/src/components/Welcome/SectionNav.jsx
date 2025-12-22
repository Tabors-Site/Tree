import { Link } from "react-router-dom";
import { sections } from "./WelcomePage";
import './SectionNav.css'

const SectionNav = ({ currentId }) => {
    const index = sections.findIndex((s) => s.id === currentId);

    const prev = index > 0 ? sections[index - 1] : null;
    const next = index < sections.length - 1 ? sections[index + 1] : null;

    return (
        <div className="section-nav">
            {prev && (
                <Link to={`/welcome/${prev.id}`} className="nav-btn">
                    Prev: {prev.label}
                </Link>
            )}

            {next && (
                <Link to={`/welcome/${next.id}`} className="nav-btn">
                    Next: {next.label}
                </Link>
            )}
        </div>

    );
};

export default SectionNav;
