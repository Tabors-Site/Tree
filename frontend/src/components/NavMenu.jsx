import React from "react";

const NavMenu = ({ username }) => {
  // This comes from your Vite env (set in .env file)
  const baseDomain = import.meta.env.VITE_BASE_DOMAIN; // e.g. "tabors.site"

  const menuItems = [
    { label: "Tree", url: `http://tree.${baseDomain}` },
    { label: "Music", url: `http://music.${baseDomain}` },
    { label: "Chat", url: `http://chat.${baseDomain}` },
  ];

  return (
    <div className="navmenu-container">
      <h1>Welcome, {username} 👋</h1>
      <p>Select a section:</p>
      <ul className="navmenu-list">
        {menuItems.map((item) => (
          <li key={item.label}>
            <a href={item.url} className="navmenu-link">
              {item.label}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
};

export default NavMenu;
