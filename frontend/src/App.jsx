import { BrowserRouter, Routes, Route } from "react-router-dom";
import WelcomePage from "./components/Welcome/WelcomePage.jsx";
import LegacyApp from "./LegacyApp.jsx";

const App = () => {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<WelcomePage />} />
        <Route path="/legacy/*" element={<LegacyApp />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
