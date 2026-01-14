import { useEffect } from "react";
import Cookies from "js-cookie";
import "./WelcomePage.css";

const apiUrl = import.meta.env.VITE_TREE_API_URL;

const WelcomePage = () => {
  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);


  const handleOpenBrowser = async () => {
    const token = Cookies.get("token");

    if (!token) {
      window.location.href = "/login";
      return;
    }

    try {
      const res = await fetch(`${apiUrl}/verify-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      });

      if (!res.ok) {
        window.location.href = "/login";
        return;
      }

      const data = await res.json();

      Cookies.set("username", data.username, { expires: 7 });
      Cookies.set("userId", data.userId, { expires: 7 });
      Cookies.set("loggedIn", true, { expires: 7 });

      if (!data.HTMLShareToken) {
        window.location.href = `${apiUrl}/user/${data.userId}/shareToken?html`;
        return;
      }

      window.location.href = `${apiUrl}/user/${data.userId}?token=${data.HTMLShareToken}&html`;
    } catch (err) {
      console.error("Open App error:", err);
      window.location.href = "/login";
    }
  };

  return (
    <div className="welcome-page">
      <section className="hero">
        <div className="hero-top">
          <a
            href="https://tabors.site"
            className="back-to-site-btn legacy"
          >
            Back to tabors.site
          </a>

          <button
            className="back-to-site-btn open-app-btn"
            onClick={handleOpenBrowser}
          >
            Open App
          </button>
        </div>


        <div className="hero-center">
          <div className="hero-logo" aria-hidden>
            🌳
          </div>

          <h1 data-text="Tree">Tree</h1>
          <h2>A Context Management System</h2>

        </div>

      </section>
    </div>
  );
};

export default WelcomePage;
