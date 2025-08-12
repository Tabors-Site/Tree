import React, { useState, useEffect } from "react";
import RootNodesForm from "./RootNodesForm"; // Ensure the path is correct
import Invites from "./Invites"; // Import the new Invites component
import "./AccountTab.css";
import Cookies from "js-cookie";
const apiUrl = import.meta.env.VITE_API_URL;
const token = Cookies.get("token");

const AccountTab = ({
  username,
  userId,
  onLogout,
  rootNodes,
  setRootNodes,
  rootSelected,
  setRootSelected,
  tree,
}) => {
  const [isHovered, setIsHovered] = useState(false);
  const [showRoots, setShowRoots] = useState(false); // State to toggle RootNodesForm visibility
  const [showInvites, setShowInvites] = useState(false); // State to toggle Invites visibility

  useEffect(() => {
    setIsHovered(false);
    setShowRoots((prev) => !prev);
  }, [rootSelected]);

  const handleLogoutClick = () => {
    if (onLogout) {
      onLogout(); // Trigger the logout function passed as a prop
    }
  };

  const toggleRootsForm = () => {
    setShowRoots((prev) => !prev); // Toggle the form visibility
  };

  const toggleInvites = () => {
    setShowInvites((prev) => !prev); // Toggle the Invites visibility
  };

  const handleDownloadTree = async () => {
    try {
      const response = await fetch(`${apiUrl}/get-all-data`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          rootId: rootSelected,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error("Error fetching data:", errorData);
        return;
      }

      const data = await response.json();
      const jsonString = JSON.stringify(data, null, 2);
      const blob = new Blob([jsonString], { type: "application/json" });
      const link = document.createElement("a");
      link.download = `${rootSelected}.json`;
      link.href = URL.createObjectURL(blob);
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (error) {
      console.error("Error fetching data:", error.message);
    }
  };

  return (
    <div
      className="account-tab"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      <span className="account-info">
        {isHovered ? (
          <div>
            <p>Username: {username}</p>
            <button onClick={handleLogoutClick}>Logout</button>
            <button onClick={toggleRootsForm}>
              {showRoots ? "Hide Roots" : "Show Roots"}
            </button>
            <button onClick={toggleInvites}>
              {showInvites ? "Hide Invites" : "Show Invites"}
            </button>
            <button onClick={handleDownloadTree} disabled={!tree}>
              Download Tree
            </button>
          </div>
        ) : (
          <p>Profile</p>
        )}
      </span>

      {showRoots && (
        <div className="account-tab-content">
          <RootNodesForm
            rootNodes={rootNodes}
            setRootNodes={setRootNodes}
            setRootSelected={setRootSelected}
            rootSelected={rootSelected}
            userId={userId}
          />
        </div>
      )}

      {showInvites && (
        <div className="account-tab-content-2">
          <Invites userId={userId} />
        </div>
      )}
    </div>
  );
};

export default AccountTab;
