import { BrowserRouter, Routes, Route } from "react-router-dom";
import WelcomeRoutes from "./components/Welcome/WelcomeRoutes.jsx";
import LegacyApp from "./components/Legacy/App.jsx";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<WelcomeRoutes />} />
        <Route path="/legacy/*" element={<LegacyApp />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
