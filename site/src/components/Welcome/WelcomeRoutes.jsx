import { Routes, Route } from "react-router-dom";
import WelcomePage from "./WelcomePage.jsx";


import EnergySection from "./About/EnergySection.jsx";
import AboutRawIdeas from "./About/AboutRawIdeas.jsx";
import DreamsAbout from "./About/DreamsAbout.jsx";
import StartedAbout from "./About/StartedAbout.jsx";
import CLIAbout from "./About/CLIAbout.jsx";
import GatewayAbout from "./About/GatewayAbout.jsx";
import LandAbout from "./About/LandAbout.jsx";
import NodeTypesAbout from "./About/NodeTypesAbout.jsx";
import ExtensionsAbout from "./About/ExtensionsAbout.jsx";
import LandingPage from "./Landing/LandingPage.jsx";
import AIArchitecturePage from "./Landing/AIArchitecturePage.jsx";
import KernelPage from "./Landing/KernelPage.jsx";
import CascadePage from "./Landing/CascadePage.jsx";
import ExtensionsPage from "./Landing/ExtensionsPage.jsx";
import NetworkPage from "./Landing/NetworkPage.jsx";
import FlowPage from "./Landing/FlowPage.jsx";
import BuildPage from "./Landing/BuildPage.jsx";
import MyceliumPage from "./Landing/MyceliumPage.jsx";
import LandPage from "./Landing/LandPage.jsx";

import ApiAccessSection from "./About/API.jsx";

import PrivacySection from "./PrivacySection.jsx";
import TermsSection from "./TermsSections.jsx";

import AboutHome from "./About/AboutHome.jsx";
import Guide from "./About/Guide.jsx";
import AboutLayout from "./About/AboutLayout.jsx";
import BlogSection from "./Blog/BlogSection.jsx";
import NotFound from "./NotFound.jsx";

const WelcomeRoutes = () => {
  // External redirect: /horizon -> horizon.treeos.ai
  const HorizonRedirect = () => {
    window.location.href = "https://horizon.treeos.ai";
    return null;
  };

  return (
    <Routes>

      {/* Landing page (protocol site) */}
      <Route path="/" element={<LandingPage />} />

      {/* /decentralized redirects to /network (old URL, kept for backcompat) */}
      <Route path="/decentralized" element={<NetworkPage />} />
      <Route path="/ai" element={<AIArchitecturePage />} />
      <Route path="/kernel" element={<KernelPage />} />
      <Route path="/seed" element={<KernelPage />} />
      <Route path="/cascade" element={<CascadePage />} />
      <Route path="/extensions" element={<ExtensionsPage />} />
      <Route path="/network" element={<NetworkPage />} />
      <Route path="/flow" element={<FlowPage />} />
      <Route path="/build" element={<BuildPage />} />
      <Route path="/cli" element={<CLIAbout />} />
      <Route path="/mycelium" element={<MyceliumPage />} />
      <Route path="/land" element={<LandPage />} />
      <Route path="/horizon" element={<HorizonRedirect />} />

      {/* Original app welcome (treeos.ai example) */}
      <Route path="/app" element={<WelcomePage />} />
      <Route path="/privacy" element={<AboutLayout />} >
        <Route index element={<PrivacySection />} />
</Route>
    <Route path="/terms" element={<AboutLayout />} >
        <Route index element={<TermsSection />} />
</Route>


      {/* Help layout */}
      <Route path="/about" element={<AboutLayout />}>
        <Route index element={<AboutHome />} />
        <Route path="api" element={<ApiAccessSection />} />
        <Route path="energy" element={<EnergySection />} />
        <Route path="raw-ideas" element={<AboutRawIdeas />} />
        <Route path="dreams" element={<DreamsAbout />} />
        <Route path="gettingstarted" element={<StartedAbout />} />
        <Route path="cli" element={<CLIAbout />} />
        <Route path="gateway" element={<GatewayAbout />} />
        <Route path="land" element={<LandAbout />} />
        <Route path="node-types" element={<NodeTypesAbout />} />
        <Route path="extensions" element={<ExtensionsAbout />} />

      </Route>

      {/* Guide (narrative, start to finish) */}
      <Route path="/guide" element={<Guide />} />

      <Route path="/blog" element={<BlogSection />} />
      <Route path="/blog/:slug" element={<BlogSection />} />

      {/* Keep /landing as alias during transition */}
      <Route path="/landing" element={<LandingPage />} />
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};


export default WelcomeRoutes;
