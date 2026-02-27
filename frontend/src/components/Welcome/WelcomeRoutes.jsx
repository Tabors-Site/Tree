import { Routes, Route } from "react-router-dom";
import WelcomePage from "./WelcomePage.jsx";


import EnergySection from "./About/EnergySection.jsx";
import AboutRawIdeas from "./About/AboutRawIdeas.jsx";

import ApiAccessSection from "./About/API.jsx";
import MustLogin from "./MustLogin.jsx";

import PrivacySection from "./PrivacySection.jsx";
import TermsSection from "./TermsSections.jsx";

import AboutHome from "./About/AboutHome.jsx";
import AboutLayout from "./About/AboutLayout.jsx";

const WelcomeRoutes = () => {
  return (
    <Routes>

      {/* Welcome layout */}
      <Route element={<WelcomePage />}>
        <Route path="/"  />
      </Route>
      <Route path="/privacy" element={<AboutLayout />} >
        <Route index element={<PrivacySection />} />
</Route>
    <Route path="/terms" element={<AboutLayout />} >
        <Route index element={<TermsSection />} />
</Route>

      <Route path="/must-login" element={<MustLogin />} />

      {/* Help layout */}
      <Route path="/about" element={<AboutLayout />}>
        <Route index element={<AboutHome />} />
        <Route path="api" element={<ApiAccessSection />} />
        <Route path="energy" element={<EnergySection />} />
        <Route path="raw-ideas" element={<AboutRawIdeas />} />

      </Route>

    </Routes>
  );
};


export default WelcomeRoutes;
