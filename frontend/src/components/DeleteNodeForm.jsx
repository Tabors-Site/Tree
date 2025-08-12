import React, { useState } from "react";
import Cookies from "js-cookie";

const DeleteNodeForm = ({ nodeSelected, tree, onComplete, setNodeSelected, rootSelected }) => {
  const apiUrl = import.meta.env.VITE_API_URL;

  // Handle form submission for manual creation
  const handleSubmit = async (e) => {
    e.preventDefault();

    if(nodeSelected._id == rootSelected){
      alert("You can not delete the root like this");
      return
    }

    // Confirm deletion action
    const confirmDelete = window.confirm(
      "Are you sure you want to delete this node and all of its children? This action is permanent."
    );

    if (!confirmDelete) {
      // If user cancels, do nothing
      return;
    }

    const token = Cookies.get("token");
    if (!token) {
      console.error("No JWT token found!");
      return;
    }

    try {
      // Check if tree is a valid object with children
      if (!tree || !tree.children || !Array.isArray(tree.children)) {
        console.error("Invalid tree structure!");
        return;
      }

      // Recursive function to find the parent of the nodeSelected
      const findParent = (nodeId, node) => {
        // Check if any of the current node's children are the selected node
        if (node.children && node.children.some(child => child._id === nodeId)) {
          return node; // Return the parent node
        }

        // Recursively search through the children of this node
        for (let child of node.children) {
          const parent = findParent(nodeId, child);
          if (parent) return parent;
        }

        return null; // Return null if parent is not found
      };

      // Find the parent node of the node to be deleted
      const parentNode = findParent(nodeSelected._id, tree);
      if (!parentNode) {
        console.error("No parent node found!");
        return;
      }

      // Now delete the node
      const response = await fetch(`${apiUrl}/delete-node`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          nodeId: nodeSelected._id,
        }),
        credentials: "include",
      });

      const data = await response.json();

      if (!response.ok) {
        console.error("Error deleting node:", data);
        throw new Error("Failed to delete node");
      }

      // After deletion, set nodeSelected to the parent node
      setNodeSelected(parentNode);

      onComplete();
    } catch (error) {
      console.error("Error deleting node:", error.message);
    }
  };

  return (
    <div>
      <h1>Delete Node and Children</h1>
      <h3>Warning: this will delete all of the nodes below and is permanent</h3>
      <form onSubmit={handleSubmit}>
        <button type="submit">Start Deletion</button>
      </form>
    </div>
  );
};

export default DeleteNodeForm;
