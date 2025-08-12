import React, { useState, useEffect } from "react";
import Cookies from "js-cookie";

const apiUrl = import.meta.env.VITE_API_URL;
const token = Cookies.get("token");

const Transactions = ({
  tree,
  nodeSelected,
  nodeVersion,
  getTree,
  rootSelected,
}) => {
  const [isTrading, setIsTrading] = useState(false);
  const [nodeTrading, setNodeTrading] = useState(null);
  const [valuesA, setValuesA] = useState({});
  const [valuesB, setValuesB] = useState({});
  const [nodeBVersion, setNodeBVersion] = useState(null);
  const [showNodeList, setShowNodeList] = useState(true);

  const handleTradeClick = () => {
    setIsTrading(true);
    setShowNodeList(true);
  };

  const handleCancelTrade = () => {
    setIsTrading(false);
    setNodeTrading(null);
    setValuesA({});
    setValuesB({});
    setNodeBVersion(null);
    setShowNodeList(true);
  };

  useEffect(() => {
    setIsTrading(false);
    setNodeTrading(null);
  }, [nodeSelected, nodeVersion]);

  const handleNodeSelect = (node) => {
    setNodeTrading(node);
    setNodeBVersion(node.prestige);
    setShowNodeList(false);
  };

  const handleValueChange = (nodeType, key, value) => {
    const numericValue = value ? Number(value) : 0;
    if (nodeType === "A") {
      setValuesA((prev) => ({
        ...prev,
        [key]: numericValue,
      }));
    } else if (nodeType === "B") {
      setValuesB((prev) => ({
        ...prev,
        [key]: numericValue,
      }));
    }
  };

  const handleVersionChange = (e) => {
    setNodeBVersion(Number(e.target.value));
  };

  const submitTrade = async () => {
    const payload = {
      nodeAId: nodeSelected._id,
      versionAIndex: nodeVersion,
      valuesA,
      nodeBId: nodeTrading._id,
      versionBIndex: nodeBVersion,
      valuesB,
    };

    try {
      const response = await fetch(`${apiUrl}/trade-values`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
        credentials: "include",
      });

      const data = await response.json();

      if (data) {
        // Ensure the cancellation happens after the trade is successful

        alert(data.message);

        getTree(rootSelected); // Refresh the tree or data after the trade

        handleCancelTrade();

        // Optionally show an error popup or message
      }
    } catch (error) {
      alert("Error during trade: " + error.message);
      // Handle fetch errors or network issues
    }
  };

  const extractNodes = (node) => {
    if (!tree || !nodeSelected) return [];

    let nodes = [];

    if (node._id !== nodeSelected._id) {
      nodes.push(node);
    }

    if (node.children) {
      node.children.forEach((child) => {
        nodes = nodes.concat(extractNodes(child));
      });
    }

    return nodes;
  };

  const allNodes = extractNodes(tree);

  return (
    <div>
      {!isTrading ? (
        <button onClick={handleTradeClick}>Trade Values To Another Node</button>
      ) : (
        <div className="trade-window">
          {showNodeList && (
            <>
              <h3>Select a Node to Trade With</h3>
              <ul>
                {allNodes.map((node) => (
                  <li key={node.name}>
                    <button onClick={() => handleNodeSelect(node)}>
                      {node.name}
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {nodeTrading && (
            <div>
              <h3>
                Trading Between {nodeSelected.name} & {nodeTrading.name}
              </h3>

              <div>
                <h4>This Node ({nodeSelected.name})</h4>
                {nodeSelected.versions[nodeVersion].values &&
                Object.keys(nodeSelected.versions[nodeVersion].values).length >
                  0 ? (
                  Object.entries(nodeSelected.versions[nodeVersion].values).map(
                    ([key, value]) => (
                      <div key={key}>
                        <label>
                          {key}: {value}
                        </label>
                        <br></br>
                        <input
                          type="number"
                          value={valuesA[key] || 0}
                          onChange={(e) =>
                            handleValueChange("A", key, e.target.value)
                          }
                        />
                      </div>
                    )
                  )
                ) : (
                  <p>This node version has nothing to trade</p>
                )}
              </div>

              <div>
                <h4>
                  {nodeTrading.name}
                  <div>
                    <select value={nodeBVersion} onChange={handleVersionChange}>
                      {nodeTrading.versions &&
                        nodeTrading.versions.map((_, index) => (
                          <option key={index} value={index}>
                            Prestige {index}
                          </option>
                        ))}
                    </select>
                  </div>
                </h4>

                {nodeTrading.versions[nodeBVersion]?.values &&
                Object.keys(nodeTrading.versions[nodeBVersion]?.values || {})
                  .length > 0 ? (
                  Object.entries(nodeTrading.versions[nodeBVersion].values).map(
                    ([key, value]) => (
                      <div key={key}>
                        <label>
                          {key}: {value}
                        </label>
                        <br></br>
                        <input
                          type="number"
                          value={valuesB[key] || 0}
                          onChange={(e) =>
                            handleValueChange("B", key, e.target.value)
                          }
                        />
                      </div>
                    )
                  )
                ) : (
                  <p>This node version has nothing to trade</p>
                )}
              </div>

              <button onClick={submitTrade}>Submit Trade</button>
              <button
                onClick={handleCancelTrade}
                style={{ marginLeft: "10px" }}
              >
                Cancel Trade
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default Transactions;
