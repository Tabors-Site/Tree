import React, { useState, useEffect } from "react";
import Cookies from "js-cookie";

const UpdateParentForm = ({ nodeSelected, tree, onComplete, setNodeSelected, rootSelected }) => {
  const [nodeNewParent, setNodeNewParent] = useState(null); // Store the new parent
  const apiUrl = import.meta.env.VITE_API_URL;



  // Extract all nodes except nodeSelected and its descendants
  const extractNodes = (node) => {
    if (!node) return [];
    let nodes = [];

    // Skip the selected node
    if (node._id !== nodeSelected._id) {
      nodes.push(node);
    }

    // Recursively check children, skip if already selected or descendant
    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((child) => {
        if (child._id !== nodeSelected._id) {
          nodes = nodes.concat(extractNodes(child));
        }
      });
    }

    return nodes;
  };

  // Get the list of all nodes except nodeSelected by calling extractNodes on the root tree object
  const availableNodes = extractNodes(tree);

  // Handle selecting a new parent node
  const handleParentSelect = (parentNode) => {
    setNodeNewParent(parentNode);  // Set the selected node as the new parent
  };

  // Handle form submission to update the parent node
  const handleSubmit = async (e) => {
    e.preventDefault();

    if (!nodeNewParent) {
      console.error("No new parent selected");
      return;
    }

    const token = Cookies.get("token");
    if (!token) {
      console.error("No JWT token found!");
      return;
    }

    try {
      const response = await fetch(`${apiUrl}/update-parent`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nodeChildId: nodeSelected._id,
          nodeNewParentId: nodeNewParent._id,  // Send the _id of the new parent node
        }),
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error("Failed to update parent");
      }

      // Call onComplete to refresh or update the tree after the update
      onComplete();
    } catch (error) {
      console.error("Error updating parent node:", error.message);
    }
  };

  // Render a list of all available nodes to select from
  const renderNodeList = (nodes) => {
    return nodes.map((node) => (
      <div
        key={node._id}
        onClick={() => handleParentSelect(node)}  // Set the clicked node as the new parent
        style={{ cursor: "pointer", padding: "5px", margin: "5px", border: "1px solid #ccc", borderRadius: "4px" }}
      >
        <p>{node.name}</p>
      </div>
    ));
  };

  return (
    <div>
      <h1>Select A New Parent Node</h1>

      <div>
        <h4>Click on a node below to set it as the new parent:</h4>
        <div style={{ marginBottom: "20px" }}>
          {renderNodeList(availableNodes)}  {/* Call function to render available nodes */}
        </div>

        {nodeNewParent && (
          <div>
            <h4>New Parent Selected: {nodeNewParent.name}</h4>
          </div>
        )}

        <form onSubmit={handleSubmit}>
          <button type="submit" disabled={!nodeNewParent}>
            Start The Adoption Process
          </button>
        </form>
      </div>
    </div>
  );
};

export default UpdateParentForm;
