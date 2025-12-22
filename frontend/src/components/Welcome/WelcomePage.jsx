import { NavLink, Outlet } from "react-router-dom";
import { useEffect, useState } from "react";
import Cookies from "js-cookie";
import "./WelcomePage.css";
import { useLocation } from "react-router-dom";


const apiUrl = import.meta.env.VITE_TREE_API_URL;

export const sections = [
  { id: "why", label: "Why I Made This" },
  { id: "structure", label: "Trees and nodes" },
  { id: "workflow", label: "How to use it" },
  { id: "ai", label: "How AI fits in" },
  { id: "pieces", label: "The 3 core pieces" },
  { id: "next", label: "What to do next" },
];

const WelcomePage = () => {
  const [hasToken, setHasToken] = useState(false);

  useEffect(() => {
    const token = Cookies.get("token");
    if (token) setHasToken(true);
  }, []);
  const location = useLocation();

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [location.pathname]);

  const handleOpenBrowser = async () => {
    const token = Cookies.get("token");
    if (!token) return;

    try {
      const res = await fetch(`${apiUrl}/verify-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      });

      if (!res.ok) return;

      const data = await res.json();

      Cookies.set("username", data.username, { expires: 7 });
      Cookies.set("userId", data.userId, { expires: 7 });
      Cookies.set("loggedIn", true, { expires: 7 });
      Cookies.set("HTMLShareToken", data.HTMLShareToken, { expires: 7 });

      window.location.href =
        `https://tree.tabors.site/api/user/${data.userId}?token=${data.HTMLShareToken}&html`;

    } catch (err) { }
  };

  return (
    <>
      <style>{`
        .welcome-header {
          display: flex;
          flex-direction: column;
          gap: 1rem;
          align-items: flex-start;
        }

        .welcome-header h1 {
          margin: 0;
          order: -1;
        }

        .header-buttons {
          display: flex;
          gap: 0.5rem;
          flex-wrap: wrap;
        }

        .header-buttons .back-to-site-btn {
          flex: 0 0 auto;
        }

        .back-to-site-btn.legacy {
          flex: 0 0 auto;
        }

        /* Desktop layout */
        @media (min-width: 768px) {
          .welcome-header {
            flex-direction: row;
            align-items: center;
            width: 100%;
          }

          .welcome-header h1 {
            order: 0;
            margin-left: 1rem;
            flex: 1;
          }

          .header-buttons {
            gap: 0.5rem;
            flex: 0 0 auto;
          }

          .back-to-site-btn.legacy {
            flex: 0 0 auto;
          }
        }
      `}</style>

      <div className="welcome-page">
        <section className="welcome-landing">
          <div className="welcome-header">
            <div className="header-buttons">
              {/* Show only if they have token */}
              {hasToken && (
                <button
                  className="back-to-site-btn"
                  onClick={handleOpenBrowser}
                >
                  URL Browser
                </button>
              )}

              <a
                href="https://tree.tabors.site/legacy"
                className="back-to-site-btn"
              >
                Open App
              </a>
            </div>

            <h1>Welcome to Treefficiency</h1>

            <a
              href="https://tabors.site"
              className="back-to-site-btn legacy"
            >
              Back to tabors.site
            </a>
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
    </>
  );
};
export default WelcomePage;
