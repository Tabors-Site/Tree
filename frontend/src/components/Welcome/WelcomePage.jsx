import { useState } from "react";
import WhySection from "./WhySection.jsx";
import StructureSection from "./StructureSection.jsx";
import HowToUseSection from "./HowUseSection.jsx";
import HowAIFitsInSection from "./HowAIFits.jsx";
import WhatToDoNextSection from "./WhatNextSection.jsx";
import UsingAllThePiecesSection from "./UsingPiecesSection.jsx";
import BeSection from "./BeSection.jsx";

import "./WelcomePage.css"

const sections = [
  { id: "why", label: "Why this exists" },
  { id: "structure", label: "How it’s structured" },
  { id: "ai", label: "How AI fits in" },
  { id: "workflow", label: "How to use it" },
  { id: "pieces", label: "The 3 core pieces" },
  { id: "be", label: "VERY IMPORTANT" },
  { id: "next", label: "What to do next" },

];

const WelcomePage = ({ onLogin }) => {
  const [active, setActive] = useState("why");

  return (
    <div className="welcome-page intro-layout">
      <aside className="intro-nav">
        {sections.map((s) => (
          <button
            key={s.id}
            className={active === s.id ? "active" : ""}
            onClick={() => setActive(s.id)}
          >
            {s.label}
          </button>
        ))}
      </aside>

      <main className="intro-content">
        {active === "why" && <WhySection />}
        {active === "structure" && <StructureSection />}
        {active === "workflow" && <HowToUseSection />}
        {active === "ai" && <HowAIFitsInSection />}
        {active === "next" && <WhatToDoNextSection />}
        {active === "be" && <BeSection />}
        {active === "pieces" && <UsingAllThePiecesSection />}







      </main>
    </div>
  );
};

export default WelcomePage;
