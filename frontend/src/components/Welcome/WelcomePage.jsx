import { useEffect, useState } from "react";
import Cookies from "js-cookie";
import "./WelcomePage.css";

const apiUrl = import.meta.env.VITE_TREE_API_URL;
const URL = `https://tree.tabors.site`;

const WelcomePage = () => {

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const bannerMessages = [
    "Welcome to Tree. Click Start Chat to get started.",
    "New: Trees can now dream. Set a sleep schedule and let your Tree organize itself overnight.",
    "New: Understanding runs detect changes incrementally — only dirty branches get reprocessed.",
    "New: Session dashboards track every AI process running across your Trees in real time.",
    "New: Start Chat offers a streamlined interface. Use the Dashboard for full control.",
    "Understanding runs summarize your entire Tree from any perspective you define.",
    "Collaborative workspaces are live. Invite others to build together.",
    "Custom LLM support is available. Bring your own key in OpenAI-compatible format.",
    "This project is in active development. Expect occasional downtime as new features ship.",
  ];

  const [bannerIndex, setBannerIndex] = useState(0);
  const [bannerPhase, setBannerPhase] = useState("enter"); // enter, hold, exit

  useEffect(() => {
    let timeout;
    if (bannerPhase === "enter") {
      timeout = setTimeout(() => setBannerPhase("hold"), 1000);
    } else if (bannerPhase === "hold") {
      timeout = setTimeout(() => setBannerPhase("exit"), 6000);
    } else if (bannerPhase === "exit") {
      timeout = setTimeout(() => {
        setBannerIndex((i) => (i + 1) % bannerMessages.length);
        setBannerPhase("enter");
      }, 600);
    }
    return () => clearTimeout(timeout);
  }, [bannerPhase]);

  const handleOpen = async (destination) => {
    const token = Cookies.get("token");
    const path = new window.URL(destination).pathname;
    const loginUrl = `/login?redirect=${encodeURIComponent(path)}`;

    if (!token) {
      window.location.href = loginUrl;
      return;
    }

    try {
      const res = await fetch(`https://tree.tabors.site/verify-token`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        credentials: "include",
      });

      if (!res.ok) {
        window.location.href = loginUrl;
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

      if (!data.hasLlm) {
        window.location.href = `${URL}/setup`;
        return;
      }

      window.location.href = destination;
    } catch (err) {
      console.error("Open App error:", err);
      window.location.href = loginUrl;
    }
  };

  const handleOpenApp = () => handleOpen(`${URL}/app`);
  const handleOpenChat = () => handleOpen(`${URL}/chat`);

  return (
    <div className="welcome-page">
      <div className="dev-banner">
        <span className={`dev-banner-text ${bannerPhase}`} key={bannerIndex}>
          {bannerMessages[bannerIndex]}
        </span>
      </div>
      <section className="hero">

        <div className="hero-top">
          <a
            href="https://tabors.site"
            className="back-to-site-btn legacy"
          >
            Back to tabors.site
          </a>

          <div className="hero-top-right">
            <button
              className="back-to-site-btn open-app-btn start-chat-btn"
              onClick={handleOpenChat}
            >
              Start Chat
            </button>
            <button
              className="back-to-site-btn open-app-btn dashboard-btn"
              onClick={handleOpenApp}
            >
              Dashboard
            </button>
          </div>
        </div>


        <div className="hero-center">

          <div className="hero-logo" aria-hidden>
            🌳
          </div>

          <h1 data-text="Tree">Tree</h1>
          <h2>A Context Management System</h2>

        </div>
        <footer className="hero-footer">
          <div className="footer-links">
            <a href="/about" className="footer-link">About</a>
            <a href={`/terms`} className="footer-link">Terms</a>
            <a href={`/privacy`} className="footer-link">Privacy</a>
          </div>
        </footer>
      </section>

    </div>
  );
};

export default WelcomePage;
