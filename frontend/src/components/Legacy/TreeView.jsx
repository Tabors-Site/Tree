import React, { useEffect, useState, useRef } from "react";
import TreeViewMenu from "./TreeViewMenu";
import cytoscape from "cytoscape";
import "./TreeView.css";

// Utility function to recursively search for a node by its id
const findNodeById = (node, id) => {
  if (node._id === id) return node;
  for (let child of node.children || []) {
    const foundNode = findNodeById(child, id);
    if (foundNode) return foundNode;
  }
  return null;
};

// Recursive function to sort the entire tree
const sortTreeByDate = (node) => {
  if (!node) return null;

  // Create a new node object to avoid mutating the original
  const sortedNode = { ...node };

  if (sortedNode.children && sortedNode.children.length > 0) {
    // Sort children by dateCreated
    sortedNode.children = sortedNode.children.slice().sort((a, b) => {
      const dateA = new Date(a.versions[a.prestige]?.dateCreated || 0);
      const dateB = new Date(b.versions[b.prestige]?.dateCreated || 0);
      return dateA - dateB;
    });

    // Recursively sort children's children
    sortedNode.children = sortedNode.children.map((child) =>
      sortTreeByDate(child)
    );
  }

  return sortedNode;
};

const TreeView = ({
  rootSelected,
  nodeSelected,
  setNodeSelected,
  setNodeVersion,
  nodeVersion,
  tree,
  getTree,
  handleToggleView,
  statusFilter,
  setStatusFilter,
}) => {
  const [canMoveUp, setCanMoveUp] = useState(false);
  const [canMoveDown, setCanMoveDown] = useState(false);
  const [canMoveSide, setCanMoveSide] = useState(false);

  const cyRef = useRef(null);
  const cyContainerRef = useRef(null);
  const isInitialized = useRef(false);

  const selectNodeById = (id) => {
    const selectedNode = findNodeById(tree, id);
    if (selectedNode) {
      setNodeSelected(selectedNode);
    }
  };

  // Function to determine the visibility of the buttons based on current selection
  const updateButtonVisibility = (currentNode) => {
    const parent = currentNode.incomers("node");
    const children = currentNode.outgoers("node");
    const siblings =
      parent.length > 0 ? parent[0].outgoers("node").toArray() : [];

    setCanMoveDown(parent.length > 0);
    setCanMoveUp(children.length > 0);
    setCanMoveSide(siblings.length > 0);
  };

  // Initialize Cytoscape once
  useEffect(() => {
    if (!cyContainerRef.current || isInitialized.current) return;
    isInitialized.current = true;

    cyRef.current = cytoscape({
      container: cyContainerRef.current,
      style: [
        {
          selector: "node",
          style: { "background-color": "data(bgColor)", label: "data(name)" },
        },
        { selector: "edge", style: { width: 2, "line-color": "#ccc" } },
        {
          selector: "node.selected",
          style: {
            "border-width": 4,
            "border-color": "#FF4500",
            "border-style": "dashed",
          },
        },
        {
          selector: "node.root",
          style: {
            "border-width": 4,
            "border-color": "#FFD700",
            "border-style": "solid",
          },
        },
      ],
    });
  }, []);

  useEffect(() => {
    if (!cyRef.current || !tree) return;
    const cyInstance = cyRef.current;

    // Sort the entire tree once
    const sortedTree = sortTreeByDate(tree);

    cyInstance.elements().remove(); // Clear previous elements

    const addTreeToCytoscape = (node, parentId = null) => {
      let bgColor = "#ccc";
      switch (node.versions[node.prestige].status) {
        case "active":
          bgColor = "green";
          break;
        case "trimmed":
          bgColor = "red";
          break;
        case "completed":
          bgColor = "#DAA520";
          break;
      }

      cyInstance.add({
        data: {
          id: node._id,
          name: `${node.name} `,
          status: node.versions[node.prestige].status,
          prestige: node.prestige,
          bgColor,
        },
      });

      // Add the edge for this node
      if (parentId) {
        cyInstance.add({ data: { source: parentId, target: node._id } });
      }

      // Process children (they're already sorted)
      (node.children || []).forEach((child) =>
        addTreeToCytoscape(child, node._id)
      );
    };

    // Start with the sorted tree
    addTreeToCytoscape(sortedTree);

    // Layout and finalize
    cyInstance
      .layout({
        name: "breadthfirst",
        roots: cyInstance.getElementById(rootSelected),
        directed: true,
        spacingFactor: 1.1,
        maximal: false,
        avoidOverlap: true,
        nodeDimensionsIncludeLabels: true,
        transform: (node, position) => ({ x: position.x, y: -position.y }),
      })
      .run();

    cyInstance.fit();
    cyInstance.zoom({ level: 0.5 });

    // Handle root and selected nodes
    const rootNode = cyInstance.getElementById(rootSelected);
    if (rootNode) rootNode.addClass("root");
    cyInstance.center(rootNode);
    if (nodeSelected) {
      const nodeSelect = cyInstance.getElementById(nodeSelected._id);
      updateButtonVisibility(nodeSelect);
    }
  }, [tree, rootSelected]);

  useEffect(() => {
    const cyInstance = cyRef.current;

    const handleNodeTap = (event) => {
      const nodeId = event.target.id();
      const tappedNode = cyInstance.getElementById(nodeId)?.data();
      if (!tappedNode) return;

      cyInstance.nodes().removeClass("selected");
      event.target.addClass("selected");

      selectNodeById(tappedNode.id);
      setNodeVersion(tappedNode.prestige);

      // Update button visibility based on new selection
      updateButtonVisibility(event.target);
    };

    cyInstance.off("tap", "node").on("tap", "node", handleNodeTap);
    return () => cyInstance.off("tap", "node", handleNodeTap);
  }, [tree, cyRef.current]);

  useEffect(() => {
    if (!cyRef.current || !nodeSelected) return;
    const cyInstance = cyRef.current;

    const handleKeyDown = (event) => {
      let currentNode = cyInstance.getElementById(nodeSelected._id);
      if (!currentNode || !currentNode.isNode()) return;

      let newSelectedNode = null;

      switch (event.key) {
        case "ArrowLeft": {
          // Move to previous sibling (looping)
          const parent = currentNode.incomers("node");
          if (parent.length > 0) {
            const siblings = parent[0].outgoers("node").toArray();
            const index = siblings.findIndex(
              (n) => n.id() === currentNode.id()
            );

            if (index > 0) {
              newSelectedNode = siblings[index - 1]; // Move to previous sibling
            } else {
              newSelectedNode = siblings[siblings.length - 1]; // Wrap to last sibling
            }
          }
          break;
        }
        case "ArrowRight": {
          // Move to next sibling (looping)
          const parent = currentNode.incomers("node");
          if (parent.length > 0) {
            const siblings = parent[0].outgoers("node").toArray();
            const index = siblings.findIndex(
              (n) => n.id() === currentNode.id()
            );

            if (index < siblings.length - 1) {
              newSelectedNode = siblings[index + 1]; // Move to next sibling
            } else {
              newSelectedNode = siblings[0]; // Wrap to first sibling
            }
          }
          break;
        }
        case "ArrowDown": {
          // Move to child
          const parent = currentNode.incomers("node");
          if (parent.length > 0) newSelectedNode = parent[0];
          break;
        }
        case "ArrowUp": {
          // Move to first parent
          const children = currentNode.outgoers("node");
          if (children.length > 0) newSelectedNode = children[0];
          break;
        }
        default:
          return;
      }

      if (newSelectedNode) {
        event.preventDefault(); // Prevent default scrolling behavior

        const newNodeId = newSelectedNode.id();
        setNodeSelected(findNodeById(tree, newNodeId));

        cyInstance.nodes().removeClass("selected");
        newSelectedNode.addClass("selected");

        // Update button visibility based on new selection
        updateButtonVisibility(newSelectedNode);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [nodeSelected, tree]);

  const moveSelection = (nodeId, direction) => {
    const cyInstance = cyRef.current;
    const currentNode = cyInstance.getElementById(nodeId);
    if (!currentNode) return;

    let newSelectedNode = null;

    switch (direction) {
      case "down": {
        const parent = currentNode.incomers("node");
        if (parent.length > 0) newSelectedNode = parent[0];
        break;
      }
      case "up": {
        const children = currentNode.outgoers("node");
        if (children.length > 0) newSelectedNode = children[0];
        break;
      }
      case "left": {
        const parent = currentNode.incomers("node");
        if (parent.length > 0) {
          const siblings = parent[0].outgoers("node").toArray();
          const index = siblings.findIndex((n) => n.id() === currentNode.id());

          if (index > 0) {
            newSelectedNode = siblings[index - 1]; // Move to previous sibling
          } else {
            newSelectedNode = siblings[siblings.length - 1]; // Wrap to last sibling
          }
        }
        break;
      }
      case "right": {
        const parent = currentNode.incomers("node");
        if (parent.length > 0) {
          const siblings = parent[0].outgoers("node").toArray();
          const index = siblings.findIndex((n) => n.id() === currentNode.id());
          if (index < siblings.length - 1) {
            newSelectedNode = siblings[index + 1]; // Move to next sibling
          } else {
            newSelectedNode = siblings[0]; // Wrap to first sibling
          }
        }
        break;
      }
      default:
        return;
    }

    if (newSelectedNode) {
      setNodeSelected(findNodeById(tree, newSelectedNode.id()));

      cyInstance.nodes().removeClass("selected");
      newSelectedNode.addClass("selected");

      // Update button visibility based on new selection
      updateButtonVisibility(newSelectedNode);
    }
  };

  // Update selected node appearance
  useEffect(() => {
    if (!cyRef.current || !nodeSelected) return;
    const cyInstance = cyRef.current;

    cyInstance.nodes().removeClass("selected");
    const selectedNode = cyInstance.getElementById(nodeSelected._id);
    if (selectedNode) {
      selectedNode.addClass("selected");
      cyInstance.animate(
        { center: { eles: selectedNode }, zoom: 1.5, padding: 50 },
        { duration: 500, easing: "ease-out-cubic" }
      );
    }
  }, [nodeSelected]);

  const handleFilterChange = (e) => {
    const { name, checked } = e.target;
    setStatusFilter((prevFilters) => ({
      ...prevFilters,
      [name]: checked,
    }));
  };

  return (
    <div>
      <div style={{ height: "100%" }}>
        <div
          ref={cyContainerRef}
          id="cy"
          style={{ width: "100%", height: "100vh" }}
        />
      </div>
      {/* Arrow buttons */}
      <div className="edge-buttons">
        {canMoveUp && (
          <button
            className="arrow-btn up-btn"
            onClick={() => moveSelection(nodeSelected?._id, "up")}
          >
            ▲
          </button>
        )}
        {canMoveDown && (
          <button
            className="arrow-btn down-btn"
            onClick={() => moveSelection(nodeSelected?._id, "down")}
          >
            ▼
          </button>
        )}
        {canMoveSide && (
          <button
            className="arrow-btn left-btn"
            onClick={() => moveSelection(nodeSelected?._id, "left")}
          >
            ◄
          </button>
        )}
        {canMoveSide && (
          <button
            className="arrow-btn right-btn"
            onClick={() => moveSelection(nodeSelected?._id, "right")}
          >
            ►
          </button>
        )}
      </div>

      {/* Filter checkboxes */}
      <div className="filters">
        <label>
          <input
            type="checkbox"
            name="active"
            checked={statusFilter.active}
            onChange={handleFilterChange}
          />
          Active
        </label>
        <label>
          <input
            type="checkbox"
            name="trimmed"
            checked={statusFilter.trimmed}
            onChange={handleFilterChange}
          />
          Trimmed
        </label>
        <label>
          <input
            type="checkbox"
            name="completed"
            checked={statusFilter.completed}
            onChange={handleFilterChange}
          />
          Completed
        </label>
      </div>

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

export default TreeView;
