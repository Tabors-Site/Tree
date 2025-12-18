import { NavLink, Outlet } from "react-router-dom";
import "./WelcomePage.css";

const sections = [
  { id: "why", label: "Why I Made This" },
  { id: "structure", label: "Trees and nodes" },
  { id: "workflow", label: "How to use it" },
  { id: "ai", label: "How AI fits in" },
  { id: "pieces", label: "The 3 core pieces" },
  { id: "next", label: "What to do next" },
];

const WelcomePage = () => {
  return (
    <div className="welcome-page">
      <section className="welcome-landing">
        <div className="welcome-header">


          <div className="header-buttons">
            <a
              href="https://tabors.site"
              className="back-to-site-btn"
            >
              Back to tabors.site
            </a>
            <a
              href="https://tree.tabors.site/legacy"
              className="back-to-site-btn legacy"
            >
              Open App
            </a>



          </div>
          <h1>Welcome to Treefficiency</h1>
        </div>
      </section>

      <div className="intro-layout">
        <aside className="intro-nav">
          {sections.map((s) => (
            <NavLink
              key={s.id}
              to={`/welcome/${s.id}`}
              className={({ isActive }) => (isActive ? "active" : "")}
            >
              {s.label}
            </NavLink>
          ))}
        </aside>

        <main className="intro-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
};

export default WelcomePage;
