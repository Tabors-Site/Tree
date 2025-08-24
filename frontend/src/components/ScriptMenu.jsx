// ScriptMenu.jsx
import React, { useState } from "react";
import Cookies from "js-cookie";
import ScriptEditor from "./ScriptEditor";

const ScriptMenu = ({ nodeSelected, getTree, rootSelected }) => {
  const apiUrl = import.meta.env.VITE_TREE_API_URL;
  const [editingScript, setEditingScript] = useState(null); // Holds script being edited or new

  const handleRun = async (scriptName) => {
    const scriptObj = nodeSelected.scripts.find((s) => s.name === scriptName);
    if (!scriptObj) return;

    // Show confirmation with the script content
    const confirmRun = window.confirm(
      `Are you sure you'd like to run this script?\n\nScript:\n${scriptObj.script}`
    );

    if (!confirmRun) return; // Cancel if user presses "Cancel"

    const token = Cookies.get("token");
    if (!token) {
      console.error("No JWT token found!");
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/executeScript`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          scriptName,
          nodeId: nodeSelected._id,
        }),
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Script executed:", data);
        getTree(rootSelected);
      } else {
        console.error("Failed to execute script:", await response.text());
      }
    } catch (error) {
      console.error("Error executing script:", error);
    }
  };

  const handleEdit = (script) => {
    setEditingScript(script); // Open editor with existing script
  };

  const handleAddNew = () => {
    setEditingScript({ name: "", script: "" }); // Open editor for new script
  };

  const handleCloseEditor = () => {
    setEditingScript(null); // Close editor
  };

  const handleSaveEditor = async ({ name, script }) => {
    const token = Cookies.get("token");
    if (!token) return;

    try {
      const response = await fetch(`${apiUrl}/updateScript`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nodeId: nodeSelected._id,
          name,
          script,
        }),
        credentials: "include",
      });

      if (response.ok) {
        const data = await response.json();
        console.log("Script saved:", data);
        getTree(rootSelected);
        handleCloseEditor();
      } else {
        console.error("Failed to save script:", await response.text());
      }
    } catch (error) {
      console.error("Error saving script:", error);
    }
  };

  if (!nodeSelected || !nodeSelected.scripts)
    return <p>No scripts available</p>;

  return (
    <div>
      <h4>Scripts</h4>
      <ul>
        {nodeSelected.scripts.map((script) => (
          <li key={script.name} style={{ marginBottom: "5px" }}>
            {script.name}{" "}
            <button onClick={() => handleEdit(script)}>Edit</button>{" "}
            <button onClick={() => handleRun(script.name)}>Run</button>
          </li>
        ))}
      </ul>

      {/* Add new script button */}
      <button onClick={handleAddNew} style={{ marginTop: "10px" }}>
        + Add New Script
      </button>

      {/* Script Editor Popup */}
      {editingScript && (
        <ScriptEditor
          scriptData={editingScript}
          onClose={handleCloseEditor}
          onSave={handleSaveEditor}
        />
      )}
    </div>
  );
};

export default ScriptMenu;
