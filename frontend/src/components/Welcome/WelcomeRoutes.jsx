import { Routes, Route } from "react-router-dom";
import WelcomePage from "./WelcomePage.jsx";

import WhySection from "./WhySection.jsx";
import StructureSection from "./StructureSection.jsx";
import HowAIFitsInSection from "./HowAIFits.jsx";
import HowToUseSection from "./HowUseSection.jsx";
import UsingAllThePiecesSection from "./UsingPiecesSection.jsx";
import WhatToDoNextSection from "./WhatNextSection.jsx";
import BeSection from "./BeSection.jsx";
import ApiAccessSection from "./API.jsx";
import MustLogin from "./MustLogin.jsx";



const WelcomeRoutes = () => {
  return (
    <Routes>

      <Route path="/" element={<WelcomePage />}>
        <Route index element={<WhatToDoNextSection />} />
      </Route>

      <Route path="/must-login" element={<MustLogin />} />



      <Route path="/welcome" element={<WelcomePage />}>
        <Route index element={<WhatToDoNextSection />} />
        <Route path="gettingstarted" element={<WhatToDoNextSection />} />
        <Route path="why" element={<WhySection />} />
        <Route path="structure" element={<StructureSection />} />
        <Route path="ai" element={<HowAIFitsInSection />} />
        <Route path="workflow" element={<HowToUseSection />} />
        <Route path="pieces" element={<UsingAllThePiecesSection />} />
        <Route path="be" element={<BeSection />} />
        <Route path="api" element={<ApiAccessSection />} />

      </Route>
    </Routes>
  );
};

export default WelcomeRoutes;
