import React, { useState } from "react";
import AiTreeView from "./AiTreeView";

const presentMoment = new Date().toISOString();


function buildTree(nodes) {
  if (!Array.isArray(nodes)) {
    console.error("buildTree expects an array but got:", nodes);
    return null;
  }

  // Make quick lookup map
  const map = {};
  nodes.forEach(n => map[n._id] = n);

  // Find root (no parent)
  const root = nodes.find(n => !n.parent);

  function transformBranch(node) {
    if (!node) return null;

    const version =
      node.versions?.[node.prestige] || node.versions?.[node.versions?.length - 1];

    const result = {
      name: node.name,
      schedule: version?.schedule ?? null,
      reeffectTime: version?.reeffectTime ?? null,
      values: node.globalValues ?? null,
      goals: version?.goals ?? null,
      children: node.children?.length
        ? node.children
          .map(childId => transformBranch(map[childId]))
          .filter(Boolean)
        : null,
    };

    Object.keys(result).forEach(key => {
      if (result[key] == null) delete result[key];
    });

    return result;
  }

  return transformBranch(root);
}



const AiCreate = ({ nodeSelected }) => {
  const [loading, setLoading] = useState(false);
  const [planDescription, setPlanDescription] = useState("");
  const [depth, setDepth] = useState(100);
  const [treeBranch, setTreeBranch] = useState([]);
  const [jsonObject, setJsonObject] = useState(null);
  const [responseError, setResponseError] = useState("");
  const apiUrl = import.meta.env.VITE_TREE_API_URL;

  const fetchFromServer = async () => {
    setLoading(true);
    setResponseError("");

    // Fetch the tree branch data before sending AI request
    const branchData = await fetchTreeBranch();

    const transformedBranch = Array.isArray(branchData)
      ? buildTree(branchData)
      : buildTree([branchData]);




    const payload = {
      treeBranchString: JSON.stringify(transformedBranch, null, 2), // <- stringify to expected key
      planDescription,
      depth,
      presentMoment,
    };





    try {
      const serverResponse = await fetch(`${apiUrl}/AiResponse`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      const result = await serverResponse.json();

      if (result.success && result.data) {
        setJsonObject(result.data); // backend already parsed JSON into schema
      } else {
        console.error("Invalid response format");
        setResponseError("Error: Invalid response format.");
      }
    } catch (error) {
      console.error("Error:", error);
      setResponseError("Error communicating with the server.");
    } finally {
      setLoading(false);
    }
  };

  const fetchTreeBranch = async () => {
    try {
      const serverResponse = await fetch(`${apiUrl}/get-parents`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ childId: nodeSelected._id }),
      });

      const result = await serverResponse.json();

      if (serverResponse.ok) {
        setTreeBranch(result); // still update state for UI
        return result;         // <-- return it so we can use it immediately
      } else {
        console.error(result.message || "Error fetching tree branch.");
        setTreeBranch([]);
        return [];
      }
    } catch (error) {
      console.error(error);
      setTreeBranch([]);
      return [];
    }
  };

  return (
    <div>
      <h1>AI Creation</h1>

      {/* Plan Description Input */}
      <div>
        <label htmlFor="plan-description">Plan Description:</label>
        <textarea
          id="plan-description"
          value={planDescription}
          onChange={(e) => setPlanDescription(e.target.value)}
          placeholder="Describe your plan..."
          rows="4"
          style={{ width: "100%" }}
        />
      </div>

      {/* Depth of Planning Slider */}
      <div>
        <label htmlFor="depth-slider">Depth of Planning: {depth}</label>
        <input
          id="depth-slider"
          type="range"
          min="1"
          max="100"
          value={depth}
          onChange={(e) => setDepth(Number(e.target.value))}
        />
      </div>

      {/* AI Response Section */}
      <div>
        <h2>AI Response</h2>
        <button onClick={fetchFromServer} disabled={loading}>
          {loading ? "Loading..." : "Generate AI Response"}
        </button>

        {responseError && <p style={{ color: "red" }}>{responseError}</p>}

        {!loading && jsonObject && (
          <AiTreeView
            jsonObject={jsonObject}
            nodeSelected={nodeSelected}
            fetchFromServer={fetchFromServer}
          />
        )}
      </div>
    </div>
  );
};

export default AiCreate;
