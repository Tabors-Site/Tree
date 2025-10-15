import axios from 'axios'; // Commo

//prebuilt functions to use in scripts
import { setValueForNodeHelper, setGoalForNodeHelper } from '../helpers/valuesHelper.js';

import { editStatusHelper, addPrestigeHelper } from '../helpers/statusesHelper.js';
import { updateScheduleHelper } from '../helpers/schedulesHelper.js';

async function getApi(url) {
  const blockedHosts = [
    "127.0.0.1",
    "localhost",
    "10.",
    "192.168.",
    ".tabors.site",
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
    next.catch(() => { }) //if a script fails, it does not send error. need to fix
  );
  return next;
}

/**
 * Factory to build safe functions bound to a specific userId
 */
function makeSafeFunctions(userId) {
  return {
    getApi,

    setValueForNode: (nodeId, key, value, version) =>
      enqueue(nodeId, () =>
        setValueForNodeHelper({ nodeId, key, value, version, userId })
      ),

    setGoalForNode: (nodeId, key, goal, version) =>
      enqueue(nodeId, () =>
        setGoalForNodeHelper({ nodeId, key, goal, version, userId })
      ),

    editStatusForNode: (nodeId, status, version, isInherited) =>
      enqueue(nodeId, () =>
        editStatusHelper({ nodeId, status, version, isInherited, userId })
      ),

    addPrestigeForNode: (nodeId) =>
      enqueue(nodeId, () => addPrestigeHelper({ nodeId, userId })),

    updateScheduleForNode: (nodeId, versionIndex, newSchedule, reeffectTime) =>
      enqueue(nodeId, () =>
        updateScheduleHelper({
          nodeId,
          versionIndex,
          newSchedule,
          reeffectTime,
          userId,
        })
      ),
  };
}

export { makeSafeFunctions };
