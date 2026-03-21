import axios from "axios";

import { setValueForNode, setGoalForNode } from "../values.js";

import { editStatus, addPrestige } from "../statuses.js";
import { updateSchedule } from "../schedules.js";

async function getApi(url) {
  const blockedHosts = [
    "127.0.0.1",
    "localhost",
    "10.",
    "192.168.",
    "." + (process.env.ROOT_FRONTEND_DOMAIN ? new URL(process.env.ROOT_FRONTEND_DOMAIN).hostname : "tabors.site"),
    "." + (process.env.TREE_FRONTEND_DOMAIN ? new URL(process.env.TREE_FRONTEND_DOMAIN).hostname : "treeos.ai"),
  ];
  const host = new URL(url).hostname;

  if (blockedHosts.some((b) => host.startsWith(b))) {
    throw new Error("Local IPs are blocked");
  }

  const res = await axios.get(url);
  return res.data;
}

// ---------------- Queue system ----------------
const nodeQueues = new Map(); // Map<nodeId, Promise>

function enqueue(nodeId, fn) {
  const last = nodeQueues.get(nodeId) || Promise.resolve();
  const next = last.then(() => fn());
  // store the next promise in the queue
  nodeQueues.set(
    nodeId,
    next.catch(() => {}), //if a script fails, it does not send error. need to fix
  );
  return next;
}

//add traverse subtree
//add note to node

//bound to user id
function makeSafeFunctions(userId) {
  return {
    getApi,

    setValueForNode: (nodeId, key, value, version) =>
      enqueue(nodeId, () =>
        setValueForNode({ nodeId, key, value, version, userId }),
      ),

    setGoalForNode: (nodeId, key, goal, version) =>
      enqueue(nodeId, () =>
        setGoalForNode({ nodeId, key, goal, version, userId }),
      ),

    editStatusForNode: (nodeId, status, version, isInherited) =>
      enqueue(nodeId, () =>
        editStatus({ nodeId, status, version, isInherited, userId }),
      ),

    addPrestigeForNode: (nodeId) =>
      enqueue(nodeId, () => addPrestige({ nodeId, userId })),

    updateScheduleForNode: (nodeId, versionIndex, newSchedule, reeffectTime) =>
      enqueue(nodeId, () =>
        updateSchedule({
          nodeId,
          versionIndex,
          newSchedule,
          reeffectTime,
          userId,
        }),
      ),
  };
}

export { makeSafeFunctions };
