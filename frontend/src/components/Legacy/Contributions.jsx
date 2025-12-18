import React, { useState, useEffect, useCallback } from "react";
import Cookies from "js-cookie";
import "./Contributions.css";

const Contributions = ({ nodeSelected }) => {
  const [contributions, setContributions] = useState([]);
  const [loading, setLoading] = useState(false);
  const apiUrl = import.meta.env.VITE_TREE_API_URL;
  // Fetch contributions data from the server
  const fetchContributions = useCallback(async () => {
    const token = Cookies.get("token");
    if (!token) {
      console.error("No JWT token found!");
      return;
    }
    if (!nodeSelected || !nodeSelected._id) {
      console.error("Node ID is not available");
      return;
    }

    if (loading) return; // Prevent multiple simultaneous requests
    setLoading(true);

    try {
      const response = await fetch(`${apiUrl}/get-contributions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`, // Include the token for authentication
        },
        body: JSON.stringify({
          nodeId: nodeSelected._id,
        }),
        credentials: "include",
      });

      if (!response.ok) {
        console.error("Failed to fetch contributions:", response.statusText);
        return;
      }

      const data = await response.json();
      if (data.contributions && data.contributions.length > 0) {
        setContributions(data.contributions);
      }
    } catch (error) {
      console.error("Error fetching contributions:", error);
    } finally {
      setLoading(false);
    }
  }, [nodeSelected]); // Only depend on `nodeSelected`

  // Trigger fetching of data when the component is mounted or nodeSelected changes
  useEffect(() => {
    if (!loading) {
      // Make sure we're not already fetching data
      fetchContributions();
    }
  }, [nodeSelected, fetchContributions]); // Only depend on `nodeSelected` and `fetchContributions`

  return (
    <div className="contributions">
      <div style={{ maxHeight: "100%", overflowY: "auto" }}>
        <h3>Contributions</h3>
        <div className="scrollable-list">
          <ul>
            {contributions.map((contribution) => (
              <li key={contribution._id}>
                <p>
                  <strong>Username:</strong> {contribution.username}
                </p>
                <p>
                  <strong>Action:</strong> {contribution.action}
                </p>
                <p>
                  <strong>Node Version:</strong> {contribution.nodeVersion}
                </p>



                {/* editValue */}
                {contribution.action === "editValue" && contribution.valueEdited && (
                  <p>
                    <strong>Edited Value:</strong>{" "}
                    {JSON.stringify(contribution.valueEdited)}
                  </p>
                )}

                {/* editStatus */}
                {contribution.action === "editStatus" && contribution.statusEdited && (
                  <p>
                    <strong>Status:</strong> {contribution.statusEdited}
                  </p>
                )}

                {/* transaction */}
                {contribution.action === "transaction" && contribution.additionalInfo && (
                  <div>
                    <h4>Trade Details</h4>
                    <p><strong>Node A:</strong> {contribution.additionalInfo.nodeA.name}</p>
                    <p><strong>Values Sent by A:</strong> {JSON.stringify(contribution.additionalInfo.nodeA.valuesSent)}</p>

                    <p><strong>Node B:</strong> {contribution.additionalInfo.nodeB.name}</p>
                    <p><strong>Values Sent by B:</strong> {JSON.stringify(contribution.additionalInfo.nodeB.valuesSent)}</p>
                  </div>
                )}

                {/* invite */}
                {contribution.action === "invite" && contribution.inviteAction && (
                  <div>
                    <p><strong>Invite Action:</strong> {contribution.inviteAction.action}</p>
                    <p><strong>Receiving User:</strong> {contribution.inviteAction.receivingUsername || "N/A"}</p>
                  </div>
                )}

                {/* editSchedule */}
                {contribution.action === "editSchedule" && contribution.scheduleEdited && (
                  <p>
                    <strong>Schedule Edited:</strong>
                    {contribution.scheduleEdited.date &&
                      new Date(contribution.scheduleEdited.date).toLocaleString()}
                    {" — "}
                    Reeffect: {contribution.scheduleEdited.reeffectTime}
                  </p>
                )}

                {/* editGoal */}
                {contribution.action === "editGoal" && contribution.goalEdited && (
                  <p>
                    <strong>Goal Edited:</strong> {JSON.stringify(contribution.goalEdited)}
                  </p>
                )}

                {/* editNameNode */}
                {contribution.action === "editNameNode" && contribution.editNameNode && (
                  <p>
                    <strong>Renamed:</strong>{" "}
                    <code>{contribution.editNameNode.oldName}</code> →{" "}
                    <code>{contribution.editNameNode.newName}</code>
                  </p>
                )}

                {/* updateParent */}
                {contribution.action === "updateParent" && contribution.updateParent && (
                  <p>
                    <strong>Parent changed:</strong>{" "}
                    <code>{contribution.updateParent.oldParentId}</code> →{" "}
                    <code>{contribution.updateParent.newParentId}</code>
                  </p>
                )}

                {/* updateChildNode */}
                {contribution.action === "updateChildNode" &&
                  contribution.updateChildNode && (
                    <p>
                      <strong>Child:</strong>{" "}
                      <code>{contribution.updateChildNode.childId}</code> was{" "}
                      <code>{contribution.updateChildNode.action}</code>
                    </p>
                  )}

                {/* editScript */}
                {contribution.action === "editScript" && contribution.editScript && (
                  <p>
                    <strong>Updated script:</strong>{" "}
                    <code>{contribution.editScript.scriptName}</code>
                  </p>
                )}

                {/* note */}
                {contribution.action === "note" && contribution.noteAction && (
                  <p>
                    <strong>Note {contribution.noteAction.action === "add" ? "added" : "removed"}:</strong>{" "}
                    <code>{contribution.noteAction.noteId}</code>
                  </p>
                )}


                <p>
                  <strong>Date:</strong>{" "}
                  {new Date(contribution.date).toLocaleString()}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
};

export default Contributions;
