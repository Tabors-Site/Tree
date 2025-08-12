import React, { useState, useEffect } from "react";
import Cookies from "js-cookie";
import TreeView from "./components/TreeView.jsx";
import TreeViewDirectory from "./components/TreeViewDirectory.jsx";
import NodeData from "./components/NodeData.jsx";
import Notes from "./components/Notes.jsx";
import Contributions from "./components/Contributions.jsx";
import Schedule from "./components/Schedule.jsx";
import AccountTab from "./components/AccountTab.jsx";
import Transactions from "./components/Transactions.jsx";

const Tree = ({ username, userId, setIsLoggedIn, setUsername, setUserId }) => {
  const [rootNodes, setRootNodes] = useState([]);
  const [rootSelected, setRootSelected] = useState(
    Cookies.get("rootSelected") || null
  );
  const [nodeSelected, setNodeSelected] = useState(null);
  const [nodeVersion, setNodeVersion] = useState(null);
  const [tree, setTree] = useState(null);
  const [statusFilter, setStatusFilter] = useState({
    active: true,
    trimmed: false,
    completed: false,
  });
  const [currentViewIndex, setCurrentViewIndex] = useState(0);
  const [isMobile, setIsMobile] = useState(false);
  const [treeViewModeMobile, setTreeViewModeMobile] = useState(true);

  const views = [TreeView, TreeViewDirectory];
  const apiUrl = import.meta.env.VITE_API_URL;

  useEffect(() => {
    setNodeSelected(null);
    if (rootSelected) {
      getTree(rootSelected);
      Cookies.set("rootSelected", rootSelected);
    }
  }, [rootSelected]);

  useEffect(() => {
    if (statusFilter && rootSelected) {
      getTree(rootSelected);
    }
  }, [statusFilter, rootSelected]);

  const getTree = async (rootId) => {
    try {
      const response = await fetch(`${apiUrl}/get-tree`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rootId }),
      });
      if (!response.ok) throw new Error("Failed to fetch tree");
      const data = await response.json();

      const filterNodes = (node) => {
        if (
          (statusFilter.active &&
            node.versions[node.prestige].status === "active") ||
          (statusFilter.trimmed &&
            node.versions[node.prestige].status === "trimmed") ||
          (statusFilter.completed &&
            node.versions[node.prestige].status === "completed")
        ) {
          if (node.children) {
            node.children = node.children.filter(filterNodes);
          }
          return true;
        }
        return false;
      };

      const filteredTree = filterNodes(data) ? data : null;
      setTree(filteredTree);

      if (nodeSelected) {
        const findNodeById = (node, id) => {
          if (node._id === id) return node;
          for (let child of node.children || []) {
            const foundNode = findNodeById(child, id);
            if (foundNode) return foundNode;
          }
          return null;
        };
        const updatedNode = findNodeById(filteredTree, nodeSelected._id);
        if (updatedNode) setNodeSelected(updatedNode);
      } else {
        setNodeSelected(filteredTree);
        setNodeVersion(filteredTree?.prestige);
      }
    } catch (error) {
      console.error("Error loading tree:", error);
    }
  };

  const handleLogout = () => {
    setIsLoggedIn(false);
    setUsername("");
    setUserId("");
    setRootSelected(null);
    setNodeSelected(null);
    setRootNodes([]);
    Cookies.remove("username");
    Cookies.remove("userId");
    Cookies.remove("loggedIn");
    Cookies.remove("token");
    Cookies.remove("rootSelected");
  };

  const handleToggleView = () => {
    setCurrentViewIndex((prevIndex) => (prevIndex + 1) % views.length);
  };

  const renderCurrentView = () => {
    if (isMobile && treeViewModeMobile) {
      if (currentViewIndex === 0) {
        return (
          <div className="tree-view">
            <TreeView
              rootSelected={rootSelected}
              getTree={getTree}
              tree={tree}
              nodeSelected={nodeSelected}
              setNodeSelected={setNodeSelected}
              nodeVersion={nodeVersion}
              setNodeVersion={setNodeVersion}
              handleToggleView={handleToggleView}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
            />
          </div>
        );
      } else if (currentViewIndex === 1) {
        return (
          <div className="tree-view-directory">
            <TreeViewDirectory
              tree={tree}
              nodeSelected={nodeSelected}
              setNodeSelected={setNodeSelected}
              handleToggleView={handleToggleView}
              nodeVersion={nodeVersion}
              getTree={getTree}
              rootSelected={rootSelected}
              statusFilter={statusFilter}
              setStatusFilter={setStatusFilter}
            />
          </div>
        );
      }
      return null;
    }

    if (!isMobile) {
      return (
        <>
          <div className="tree-view">
            {currentViewIndex === 0 ? (
              <TreeView
                rootSelected={rootSelected}
                getTree={getTree}
                tree={tree}
                nodeSelected={nodeSelected}
                setNodeSelected={setNodeSelected}
                nodeVersion={nodeVersion}
                setNodeVersion={setNodeVersion}
                handleToggleView={handleToggleView}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
              />
            ) : (
              <TreeViewDirectory
                tree={tree}
                nodeSelected={nodeSelected}
                setNodeSelected={setNodeSelected}
                handleToggleView={handleToggleView}
                nodeVersion={nodeVersion}
                getTree={getTree}
                rootSelected={rootSelected}
                statusFilter={statusFilter}
                setStatusFilter={setStatusFilter}
              />
            )}
          </div>
          <div className="main-content">
            <div className="node-data">
              <NodeData
                nodeSelected={nodeSelected}
                nodeVersion={nodeVersion}
                setNodeVersion={setNodeVersion}
                getTree={getTree}
                rootSelected={rootSelected}
                tree={tree}
              />
              <Transactions
                nodeSelected={nodeSelected}
                tree={tree}
                nodeVersion={nodeVersion}
                getTree={getTree}
                rootSelected={rootSelected}
              />
            </div>
            <div className="notes">
              <Notes
                nodeSelected={nodeSelected}
                userId={userId}
                nodeVersion={nodeVersion}
              />
            </div>
          </div>
          <div className="side-content">
            <div className="schedule">
              <Schedule
                nodeSelected={nodeSelected}
                tree={tree}
                nodeVersion={nodeVersion}
                getTree={getTree}
                rootSelected={rootSelected}
              />
            </div>
            <div className="transaction">
              <Contributions nodeSelected={nodeSelected} />
            </div>
          </div>
        </>
      );
    }
    return null;
  };

  return (
    <>
      <div className="header">
        <AccountTab
          username={username}
          userId={userId}
          onLogout={handleLogout}
          setRootNodes={setRootNodes}
          rootNodes={rootNodes}
          setRootSelected={setRootSelected}
          rootSelected={rootSelected}
          tree={tree}
        />
      </div>
      {isMobile && treeViewModeMobile ? (
        renderCurrentView()
      ) : (
        <>
          {renderCurrentView()}
          <div className="main-content">
            <div className="node-data">
              <NodeData
                nodeSelected={nodeSelected}
                nodeVersion={nodeVersion}
                setNodeVersion={setNodeVersion}
                getTree={getTree}
                rootSelected={rootSelected}
                tree={tree}
              />
              <Transactions
                nodeSelected={nodeSelected}
                tree={tree}
                nodeVersion={nodeVersion}
                getTree={getTree}
                rootSelected={rootSelected}
              />
            </div>
            <div className="notes">
              <Notes
                nodeSelected={nodeSelected}
                userId={userId}
                nodeVersion={nodeVersion}
              />
            </div>
          </div>
          <div className="side-content">
            <div className="schedule">
              <Schedule
                nodeSelected={nodeSelected}
                tree={tree}
                nodeVersion={nodeVersion}
                getTree={getTree}
                rootSelected={rootSelected}
              />
            </div>
            <div className="transaction">
              <Contributions nodeSelected={nodeSelected} />
            </div>
          </div>
        </>
      )}
      {isMobile && (
        <button
          className="tree-view-toggle-btn"
          onClick={() => setTreeViewModeMobile((prev) => !prev)}
        >
          {treeViewModeMobile ? "Show Details" : "Show Tree"}
        </button>
      )}
    </>
  );
};

export default Tree;
