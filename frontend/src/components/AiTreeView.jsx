import React, { useState, useEffect, useRef } from "react";
import cytoscape from "cytoscape";
import "./AiTreeView.css";
import Cookies from "js-cookie";
const apiUrl = import.meta.env.VITE_API_URL;

const AiTreeViewModal = ({ jsonObject, onAddNode, onReshuffle, nodeSelected, onClose }) => {
  const cyRef = useRef(null);
  const tooltipRef = useRef(null);
  const [tooltipContent, setTooltipContent] = useState(""); 
  const [tooltipPosition, setTooltipPosition] = useState({ x: 0, y: 0 });

  const addNodesAndEdges = (node, cyInstance, parentId = null) => {
    cyInstance.add({
      group: "nodes",
      data: { id: node.name, label: node.name, details: node },
    });

    if (parentId) {
      cyInstance.add({
        group: "edges",
        data: { id: `${parentId}-${node.name}`, source: parentId, target: node.name },
      });
    }

    if (node.children && Array.isArray(node.children)) {
      node.children.forEach((child) => addNodesAndEdges(child, cyInstance, node.name));
    }
  };

  useEffect(() => {
    cyRef.current = cytoscape({
      container: document.getElementById("cy-container"),
      style: [
        {
          selector: "node",
          style: {
            content: "data(label)",
            "text-valign": "center",
            "text-halign": "center",
            "background-color": "#61bffc",
            "border-width": 1,
            "border-color": "#000",
          },
        },
        {
          selector: "edge",
          style: {
            "curve-style": "bezier",
            "target-arrow-shape": "triangle",
            "line-color": "#ccc",
            "target-arrow-color": "#ccc",
          },
        },
      ],
      layout: {
        name: "breadthfirst",
        directed: true,
        spacingFactor: 1.1,
        maximal: true,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
      },
    });

    if (jsonObject) {
      addNodesAndEdges(jsonObject, cyRef.current);
    }

    cyRef.current.layout({
      name: "breadthfirst",
      directed: true,
      spacingFactor: 1.1,
      maximal: true,
      avoidOverlap: true,
      nodeDimensionsIncludeLabels: true,
      transform: function (node, position) {
        return {
          x: position.x,
          y: -position.y,
        };
      },
    }).run();

    cyRef.current.on("mouseover", "node", (event) => {
      const node = event.target;
      const nodeData = node.data().details;

      const formattedData = `
        Name: ${nodeData.name}
        Schedule: ${nodeData.schedule}
        Effect Time: ${nodeData.reeffectTime} hrs
        Values: ${JSON.stringify(nodeData.values, null, 2)}
        Goals: ${JSON.stringify(nodeData.goals, null, 2)}
      `;
    
      const position = node.renderedPosition();
    
      setTooltipContent(formattedData);
      setTooltipPosition({
        x: position.x,
        y: position.y + 20, // Moves tooltip **below** the node
      });
    });

    cyRef.current.on("mouseout", "node", () => {
      setTooltipContent("");
    });

    return () => {
      if (cyRef.current) {
        cyRef.current.destroy();
      }
    };
  }, [jsonObject]);

  return (
    <div className="modal">
      <div className="modal-content">
        <div className="button-container">
          <button onClick={onClose} className="close">&times;</button>
          <button onClick={onAddNode}>Add to Tree</button>
          <button onClick={onReshuffle}>Reshuffle</button>
        </div>
        <h2>New Branch Idea</h2>
        {tooltipContent && (
          <div
            className="tooltip"
            ref={tooltipRef}
            style={{
              position: "absolute",
              top: "10px",  // Fixed position at the top
              left: "10px", // Fixed position at the left
              color: "black",
              background: "#fff",
              padding: "5px",
              border: "1px solid #ccc",
              zIndex: 1000,
              whiteSpace: "pre-wrap",
              boxShadow: "2px 2px 10px rgba(0,0,0,0.2)",
              borderRadius: "5px",
              maxWidth: "300px",
            }}
          >
            {tooltipContent}
          </div>
        )}

        <div id="cy-container" style={{ width: "100%", height: "500px", border: "1px solid #ccc" }}></div>
      </div>
    </div>
  );
};

const addToTree = async (json, nodeSelected) => {
  const token = Cookies.get("token");
  try {
    const response = await fetch(`${apiUrl}/add-nodes-tree`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        parentId: nodeSelected._id, // Correctly pass selected node ID
        nodeTree: json, // Pass json as the node data
      }),
      credentials: "include",
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Error adding node:", data);
      throw new Error("Failed to create node");
    }

    console.log("Node added:", data);
    // Optional: Update your tree or UI state here if needed.
  } catch (error) {
    console.error("Error setting schedule:", error.message);
  }
};

const AiTreeView = ({ jsonObject, nodeSelected, fetchFromServer }) => {
  const [showModal, setShowModal] = useState(true);

  const handleAddNode = async () => {
    await addToTree(jsonObject, nodeSelected);
  };

  const handleReshuffle = () => {
    fetchFromServer();
  };

  const handleCloseModal = () => {
    setShowModal(false); // Hide modal
    jsonObject
  };

  return (
    <div>
      {showModal && (
        <AiTreeViewModal
          jsonObject={jsonObject}
          onAddNode={handleAddNode}
          onReshuffle={handleReshuffle}
          nodeSelected={nodeSelected}
          onClose={handleCloseModal}
        />
      )}
    </div>
  );
};

export default AiTreeView;
 