import React, { useState } from "react";
import "./ScriptEditor.css";
import ScriptHelp from "./ScriptHelp.jsx"; // import the help component

const ScriptEditor = ({ scriptData, onClose, onSave }) => {
  const [scriptName, setScriptName] = useState(scriptData?.name || "");
  const [scriptContent, setScriptContent] = useState(scriptData?.script || "");
  const [showHelp, setShowHelp] = useState(false); // state to show help window

  const handleSave = () => {
    if (onSave) {
      onSave({ name: scriptName, script: scriptContent });
    }
    if (onClose) {
      onClose(); // Close the editor after saving
    }
  };

  return (
    <>
      <div className="script-editor-overlay">
        <div className="script-editor-container">
          {/* Top Header */}
          <h2>Script Editor</h2>

          {/* Script Name Editable Section */}
          <div className="script-name-section">
            <label style={{ display: "block", marginBottom: "5px" }}>
              Name
            </label>
            <input
              type="text"
              value={scriptName}
              onChange={(e) => setScriptName(e.target.value)}
              placeholder="Script Name"
            />
          </div>

          {/* Buttons Section */}
          <div className="script-buttons">
            <button onClick={() => setShowHelp(true)}>Help</button>
            <button onClick={handleSave}>Save</button>
            <button onClick={onClose}>X</button>
          </div>

          {/* Script Content Section */}
          <textarea
            className="script-textarea"
            value={scriptContent}
            onChange={(e) => setScriptContent(e.target.value)}
            placeholder="Write your script here..."
          />
        </div>
      </div>

      {/* Render Help component if showHelp is true */}
      {showHelp && <ScriptHelp onClose={() => setShowHelp(false)} />}
    </>
  );
};

export default ScriptEditor;
