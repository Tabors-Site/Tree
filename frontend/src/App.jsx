import { BrowserRouter, Routes, Route } from "react-router-dom";
import WelcomeRoutes from "./components/Welcome/WelcomeRoutes.jsx";
import LegacyApp from "./components/Legacy/App.jsx";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/*" element={<WelcomeRoutes />} />

      </Routes>
    </BrowserRouter>
  );
};

export default App;

//removed path
//<Route path="/legacy/*" element={<LegacyApp />} />