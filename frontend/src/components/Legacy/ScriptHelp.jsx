import React from "react";
import "./ScriptHelp.css";

const ScriptHelp = ({ onClose }) => {
  return (
    <div className="script-help-overlay">
      <div className="script-help-container">
        {/* Top Header */}
        <div className="script-help-header">
          <h2>Help</h2>
          <button className="close-button" onClick={onClose}>
            X
          </button>
        </div>

        {/* Content Section */}
        <div className="script-help-content">
          <h3>Accessing the current node data</h3>
          <p>
            Note: it does not update throughout the script, so be careful
            calling it after transactions unless manually updating the object.
          </p>

          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>node._id</td>
                <td>Returns Node ID (UUID)</td>
              </tr>
              <tr>
                <td>node.name</td>
                <td>Returns node name (string)</td>
              </tr>
              <tr>
                <td>node.type</td>
                <td>Node type (currently null)</td>
              </tr>
              <tr>
                <td>node.prestige</td>
                <td>Current highest version index (number)</td>
              </tr>
              <tr>
                <td>node.globalValues</td>
                <td>
                  <pre>
                    {`Accumulative values for all versions. Returns object like:
{ "string": number, "anotherString": number }`}
                  </pre>
                </td>
              </tr>
            </tbody>
          </table>

          <h4>Version Properties</h4>
          <p>
            For i below, put number for generation. 0 for first, node.prestige
            for most current.
          </p>
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>node.versions[i].values</td>
                <td>
                  <pre>{`Returns object like { "string": number, ... }`}</pre>
                </td>
              </tr>
              <tr>
                <td>node.versions[i].goals</td>
                <td>
                  <pre>{`Returns object like { "string": number, ... }`}</pre>
                </td>
              </tr>
              <tr>
                <td>node.versions[i].schedule</td>
                <td>Returns a timestamp, e.g., "2025-08-15T11:28:18.827Z"</td>
              </tr>
              <tr>
                <td>node.versions[i].prestige</td>
                <td>Number: current generation of version</td>
              </tr>
              <tr>
                <td>node.versions[i].reeffectTime</td>
                <td>Hours to repeat schedule after prestige</td>
              </tr>
              <tr>
                <td>node.versions[i].status</td>
                <td>String: "active", "completed", "trimmed"</td>
              </tr>
              <tr>
                <td>node.versions[i].dateCreated</td>
                <td>Timestamp of creation</td>
              </tr>
            </tbody>
          </table>

          <h4>Other Node Properties</h4>
          <table>
            <thead>
              <tr>
                <th>Property</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>node.scripts</td>
                <td>Returns array of scripts: [{`{name, script}`}, ...]</td>
              </tr>
              <tr>
                <td>node.children</td>
                <td>Array of child nodes (full structure)</td>
              </tr>
              <tr>
                <td>node.parent</td>
                <td>Parent node ID (UUID) or 'null' if root</td>
              </tr>
              <tr>
                <td>node.rootOwner</td>
                <td>ID of user who owns root node (UUID), else 'null'</td>
              </tr>
            </tbody>
          </table>

          <h3>Built-in Functions</h3>
          <table>
            <thead>
              <tr>
                <th>Function</th>
                <th>Description</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>getApi()</td>
                <td>Fetches data from API with GET. Returns a promise.</td>
              </tr>
              <tr>
                <td>setValueForNode(nodeId, key, value, version)</td>
                <td>Sets a value in node.versions[version].values[key]</td>
              </tr>
              <tr>
                <td>setGoalForNode(nodeId, key, goal, version)</td>
                <td>Sets a goal in node.versions[version].goals[key]</td>
              </tr>
              <tr>
                <td>editStatusForNode(nodeId, status, version, isInherited)</td>
                <td>
                  Updates node.versions[version].status. Status can be "active",
                  "completed", "trimmed". isInherited: boolean to propagate to
                  children.
                </td>
              </tr>
              <tr>
                <td>addPrestigeForNode(nodeId)</td>
                <td>Prestiges the node by one generation</td>
              </tr>
              <tr>
                <td>
                  updateScheduleForNode(nodeId, versionIndex, newSchedule,
                  reeffectTime)
                </td>
                <td>
                  Sets node.versions[versionIndex].schedule to newSchedule
                  (timestamp) and reeffectTime in hours
                </td>
              </tr>
            </tbody>
          </table>

          <h3>Example Script</h3>
          <pre>
            {`// This script creates a node that will help taper off something.
let waitTime = node.versions[node.prestige].values.waitTime;
const newWaitTime = waitTime * 1.05;
addPrestigeForNode(node._id);
const now = new Date();
const newSchedule = new Date(now.getTime() + waitTime * 3600 * 1000); // convert hours to ms
updateScheduleForNode(node._id, node.prestige + 1, newSchedule, 0);
setValueForNode(node._id, "waitTime", newWaitTime, node.prestige + 1);

// All functions run in order called; if one fails, remaining still run.`}
          </pre>
        </div>
      </div>
    </div>
  );
};

export default ScriptHelp;
