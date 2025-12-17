import React, { useState, useEffect } from "react";
import RootNodesForm from "./RootNodesForm"; // Ensure the path is correct
import Invites from "./Invites"; // Import the new Invites component
import HTMLShareTokenEditor from "./HTMLShareTokenEditor";
import "./AccountTab.css";
import Cookies from "js-cookie";
const apiUrl = import.meta.env.VITE_TREE_API_URL;
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

  const [showTokenEditor, setShowTokenEditor] = useState(false);
  const [htmlShareToken, setHtmlShareToken] = useState("");

  useEffect(() => {
    const cookieToken = Cookies.get("HTMLShareToken");
    if (cookieToken) {
      setHtmlShareToken(cookieToken);
    }
  }, []);

  useEffect(() => {
    setIsHovered(false);

    if (!rootSelected) {
      // If no root selected → show the form
      setShowRoots(true);
    } else {
      // If a root is selected (even from cookies) → hide the form
      setShowRoots(false);
    }
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
            <button onClick={handleLogoutClick}>Back to home</button>
            <button onClick={toggleRootsForm}>
              {showRoots ? "Hide Roots" : "Show Roots"}
            </button>
            <button onClick={toggleInvites}>
              {showInvites ? "Hide Invites" : "Show Invites"}
            </button>
            <button onClick={() => setShowTokenEditor(true)}>
              HTML Share Token
            </button>

            <button
              onClick={() => {
                const shareToken = Cookies.get("HTMLShareToken");
                if (!shareToken || shareToken == "null" || shareToken == "") {
                  alert("Please set a custom HTML share token first. More unique is better.");
                  return;
                }

                const basePath = rootSelected
                  ? `/root/${rootSelected}`
                  : `/user/${userId}`;

                const url = `${apiUrl}${basePath}?token=${encodeURIComponent(
                  shareToken
                )}&html`;

                window.open(url, "_blank");
              }}
              disabled={!htmlShareToken}
            >
              HTML Browser
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
      {showTokenEditor && (
        <HTMLShareTokenEditor
          initialValue={htmlShareToken}
          onSaved={setHtmlShareToken}
          onClose={() => setShowTokenEditor(false)}
        />
      )}

    </div>
  );
};

export default AccountTab;
