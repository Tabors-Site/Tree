import { Routes, Route } from "react-router-dom";

// New site (post-rebuild 2026)
import NewLandingPage from "./NewLandingPage.jsx";
import IbpPage from "./IbpPage.jsx";
import GetStartedPage from "./GetStartedPage.jsx";
import FactoryLayout from "./FactoryLayout.jsx";
import FactoryOverview from "./FactoryOverview.jsx";
import FactoryIntake from "./FactoryIntake.jsx";
import FactoryAssign from "./FactoryAssign.jsx";
import FactoryFold from "./FactoryFold.jsx";
import FactoryMomentum from "./FactoryMomentum.jsx";
import FactoryStamped from "./FactoryStamped.jsx";

// Blog stays at root (/blog and /blog/:slug). The component crossed
// the rebuild seam unchanged; we just import it from where it now
// lives (under old/) and mount it at both root and /old/.
import BlogSection from "./old/Blog/BlogSection.jsx";

// Legacy site preserved under /old/*
import OldRoutes from "./old/OldRoutes.jsx";

// 404 (shared between new and old)
import NotFound from "./old/NotFound.jsx";

/**
 * WelcomeRoutes. Dispatcher between the new site and the legacy site.
 *
 *   /                       NEW landing (two buttons plus "What is this?")
 *   /ibp                    NEW IBP page (transport plus four verbs)
 *   /factory                NEW factory overview plus chapter walk
 *   /factory/<chapter>      NEW factory chapter (intake / assign / fold / momentum / stamped)
 *   /blog, /blog/:slug      Blog at root (component lives under old/Blog/)
 *   /old/*                  EVERY legacy route, preserved verbatim
 *   *                       404
 *
 * The new pages live alongside the legacy components but use the `.ns-*`
 * CSS class prefix so styles never collide with the legacy `.lp-*` rules
 * still loaded under /old/*.
 */
const WelcomeRoutes = () => {
  return (
    <Routes>
      {/* New site */}
      <Route path="/" element={<NewLandingPage />} />
      <Route path="/ibp" element={<IbpPage />} />
      <Route path="/start" element={<GetStartedPage />} />
      <Route path="/factory" element={<FactoryLayout />}>
        <Route index element={<FactoryOverview />} />
        <Route path="intake"   element={<FactoryIntake />} />
        <Route path="assign"   element={<FactoryAssign />} />
        <Route path="fold"     element={<FactoryFold />} />
        <Route path="momentum" element={<FactoryMomentum />} />
        <Route path="stamped"  element={<FactoryStamped />} />
      </Route>

      {/* Blog at root level (stayed at /blog/* across the rebuild) */}
      <Route path="/blog" element={<BlogSection />} />
      <Route path="/blog/:slug" element={<BlogSection />} />

      {/* Legacy site, every old route */}
      <Route path="/old/*" element={<OldRoutes />} />

      {/* 404 */}
      <Route path="*" element={<NotFound />} />
    </Routes>
  );
};

export default WelcomeRoutes;
