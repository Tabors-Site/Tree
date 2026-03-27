import { useEffect, useState } from "react";
import "./WelcomePage.css";

const apiUrl = import.meta.env.VITE_TREE_API_URL;

const LAND_NAME = import.meta.env.VITE_LAND_NAME || "TreeOS Land";


const WelcomePage = () => {

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, []);
  const bannerMessages = [
    `Welcome to ${LAND_NAME} Land! Click Start Chat to get started.` ,
    "New: Gateway channels are live. Connect Telegram, Discord, or web push for input, output, or full chat.",
    "Trees can now dream. Set a sleep schedule and let your Tree organize itself overnight.",
    "Understanding runs detect changes incrementally. No more wasted LLM power.",
    "New: Session dashboards track every AI process running across your Trees in real time.",
    "Start Chat offers a streamlined interface. Use the Dashboard for full control.",
    "Understanding runs summarize your entire Tree from any perspective you define.",
    "Collaborative workspaces are live. Invite others to build together.",
    "Redudant LLM retry system is now available.",
    "This project is in active development. Expect occasional downtime as new features ship.",
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

  // Server-side auth check routes. No JavaScript cookie reading needed.
  // The server reads the httpOnly cookie, verifies, and redirects.
  const chatUrl = `${apiUrl}/auth-redirect?to=chat`;
  const dashboardUrl = `${apiUrl}/auth-redirect?to=dashboard`;

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
            href={import.meta.env.VITE_HORIZON}
            className="back-to-site-btn legacy"
          >
            Horizon
          </a>

          <div className="hero-top-right">
            <a
              href={chatUrl}
              className="back-to-site-btn open-app-btn start-chat-btn"
            >
              Start Chat
            </a>
            <a
              href={dashboardUrl}
              className="back-to-site-btn open-app-btn dashboard-btn"
            >
              Dashboard
            </a>
          </div>
        </div>


        <div className="hero-center">
          <a href="/" style={{ textDecoration: "none", color: "inherit" }}>
            <div className="hero-logo" aria-hidden>
              🌳
            </div>

            <h1 data-text={LAND_NAME + " Land"} Land>{LAND_NAME} Land</h1>
          </a>
          <h2>First ever OS built off The Seed</h2>

        </div>
        <footer className="hero-footer">
          <div className="footer-links">
            <a href="/about" className="footer-link">About</a>
            <a href="/blog" className="footer-link">Blog</a>
            <a href={`/terms`} className="footer-link">Terms</a>
            <a href={`/privacy`} className="footer-link">Privacy</a>
          </div>
        </footer>
      </section>

    </div>
  );
};

export default WelcomePage;
