import React, { useEffect } from "react";
import "./TreeViewDirectory.css";
import TreeViewMenu from "./TreeViewMenu";

// Utility function to recursively search for a node by its id
const findNodeById = (node, id) => {
  if (node._id === id) {
    return node;
  }

  // Check children recursively
  for (let child of node.children || []) {
    const foundNode = findNodeById(child, id);
    if (foundNode) {
      return foundNode;
    }
  }

  return null; // Return null if not found
};

const TreeViewDirectory = ({
  nodeSelected,
  setNodeSelected,
  tree,
  handleToggleView,
  nodeVersion,
  getTree,
  rootSelected,
}) => {
  // Function to handle clicking on a node
  const handleNodeClick = (id) => {
    const node = findNodeById(tree, id);
    if (node) {
      setNodeSelected(node);
    }
  };

  // Finding the parent node using the nodeSelected's parent ID
  const parentNode =
    nodeSelected && nodeSelected.parent
      ? findNodeById(tree, nodeSelected.parent)
      : null;

  // Directly using children from the nodeSelected as they are already the nodes themselves, not just IDs
  const childrenNodes =
    nodeSelected && Array.isArray(nodeSelected.children)
      ? nodeSelected.children
      : [];
  // Function to get labels based on index
  const getChildLabel = (index) => {
    if (index <= 9) return index.toString(); // 0-9
    return String.fromCharCode(97 + (index - 10)); // a-z for subsequent nodes
  };

  // Key press handler for node selection
  useEffect(() => {
    const handleKeyPress = (e) => {
      const key = e.key.toLowerCase();

      // Ignore non-numeric and non-alphabetical keys
      if (/[^a-z0-9]/.test(key)) return;

      // Ensure we're not typing in an input field
      if (e.target.tagName === "INPUT" || e.target.tagName === "TEXTAREA") {
        return; // Do nothing if focused on input
      }

      // Check if key corresponds to a child index (0-9 or a-z)
      const index =
        key >= "0" && key <= "9"
          ? parseInt(key, 10)
          : key.charCodeAt(0) - 97 + 10;

      // If key is "0" and we're at root, do nothing
      if (key === "0" && !nodeSelected?.parent) return;

      // Handle parent selection with "0"
      if (key === "0" && parentNode) {
        handleNodeClick(parentNode._id);
        return;
      }

      // Adjust index for children (since parent is now 0)
      const adjustedIndex = index - 1;
      if (adjustedIndex >= 0 && adjustedIndex < childrenNodes.length) {
        const selectedNode = childrenNodes[adjustedIndex];
        handleNodeClick(selectedNode._id);
      }
    };

    window.addEventListener("keydown", handleKeyPress);

    // Clean up event listener on component unmount
    return () => {
      window.removeEventListener("keydown", handleKeyPress);
    };
  }, [childrenNodes, parentNode, nodeSelected]);

  return (
    <div className="tree-view-directory">
      <div className="selected-node">
        <h2>Current: {nodeSelected ? nodeSelected.name : "None"}</h2>
      </div>

      {/* Header Line */}
      <hr />

      {/* Combined List of Parent and Children Nodes */}
      <ul className="nodes-list">
        {/* Parent Node (always 0) */}
        {nodeSelected?.parent === null ? (
          <li>
            <span className="unclickable">(THIS IS ROOT)</span>
          </li>
        ) : (
          <li>
            <span
              onClick={() => parentNode && handleNodeClick(parentNode._id)}
              style={{
                cursor: "pointer",
                color: "#1E90FF",
                fontWeight: "bolder",
              }}
            >
              0: {parentNode ? parentNode.name : "None"} (parent)
            </span>
          </li>
        )}

        {/* Children Nodes (starting from 1) */}
        {childrenNodes.length > 0 ? (
          childrenNodes.map((child, index) => (
            <li key={child._id}>
              <span
                onClick={() => handleNodeClick(child._id)}
                style={{ cursor: "pointer", color: "#1E90FF" }}
              >
                {getChildLabel(index + 1)}: {child.name}
              </span>
            </li>
          ))
        ) : (
          <li>No children available</li>
        )}
      </ul>

      {/* Selected Node Display */}
      <TreeViewMenu
        nodeSelected={nodeSelected}
        nodeVersion={nodeVersion}
        getTree={getTree}
        rootSelected={rootSelected}
        handleToggleView={handleToggleView}
        tree={tree}
        setNodeSelected={setNodeSelected}
      />
    </div>
  );
};

export default TreeViewDirectory;
