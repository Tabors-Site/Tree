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
    "Welcome to Tree. Click the Open App button to get started.",

  "02/12/2026: This project is in active development. Expect occasional downtime as things are built.",
    "01/28/2025: AI Modes are live with custom LLM support (OpenAI API format supported)",
        "01/20/2025: Try making an understanding run. The AI will summarize your whole tree from a perspective.",
                "The energy system is now live for public use. Stripe has been intregrated, but payments will not be accepted until the App is more complete.",


  "02/17/2026: LLM Mode Orchestration coming soon! Design complex workflows with multiple LLMs.",

  "Tree now supports collaborative workspaces. Invite others to build together.",
    "New perspectives are revealing.",

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

  const handleOpenBrowser = async () => {
    const token = Cookies.get("token");

    if (!token) {
      window.location.href = "/login";
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

      window.location.href = `${URL}/app`;
    } catch (err) {
      console.error("Open App error:", err);
      window.location.href = "/login";
    }
  };

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
