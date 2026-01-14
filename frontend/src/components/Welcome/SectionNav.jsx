import { Link } from "react-router-dom";
//import { sections } from "./WelcomePage";

const SectionNav = ({ currentId }) => {
    const currentIndex = sections.findIndex((s) => s.id === currentId);
    const prevSection = currentIndex > 0 ? sections[currentIndex - 1] : null;
    const nextSection = currentIndex < sections.length - 1 ? sections[currentIndex + 1] : null;

    return (
        <nav className="section-nav">
            {prevSection ? (
                <Link to={`/welcome/${prevSection.id}`} className="prev">
                    {prevSection.label}
                </Link>
            ) : (
                <div />
            )}

            {nextSection && (
                <Link to={`/welcome/${nextSection.id}`} className="next">
                    {nextSection.label}
                </Link>
            )}
        </nav>
    );
};

export default SectionNav;