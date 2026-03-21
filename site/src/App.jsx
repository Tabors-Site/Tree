import { BrowserRouter, Routes, Route, useLocation } from "react-router-dom";
import { useEffect } from "react";
import WelcomeRoutes from "./components/Welcome/WelcomeRoutes.jsx";

const ScrollToTop = () => {
  const { pathname } = useLocation();
  useEffect(() => { window.scrollTo(0, 0); }, [pathname]);
  return null;
};

const App = () => {
  return (
    <BrowserRouter>
      <ScrollToTop />
      <Routes>
        <Route path="/*" element={<WelcomeRoutes />} />

      </Routes>
    </BrowserRouter>
  );
};

export default App;

//removed path
//<Route path="/legacy/*" element={<LegacyApp />} />