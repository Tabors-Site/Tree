import { Outlet } from "react-router-dom";
import "./AboutLayout.css";

const AboutLayout = () => {
  return (
    <div className="about-layout">
      <Outlet />
    </div>
  );
};

export default AboutLayout;