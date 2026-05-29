import { Outlet } from "react-router-dom";
import SiteHeader from "./SiteHeader.jsx";
import SiteFooter from "./SiteFooter.jsx";
import FactorySidebar from "./FactorySidebar.jsx";
import "./FactoryLayout.css";

/**
 * FactoryLayout. Wraps every /factory/* page. Header, sidebar,
 * chapter content (the Outlet), footer. The sidebar collapses to a
 * horizontal scroll bar on narrow screens (see FactorySidebar.css).
 */
const FactoryLayout = () => {
  return (
    <div className="ns-page">
      <SiteHeader />
      <div className="ns-factory-shell">
        <FactorySidebar />
        <main className="ns-factory-main">
          <Outlet />
        </main>
      </div>
      <SiteFooter />
    </div>
  );
};

export default FactoryLayout;
