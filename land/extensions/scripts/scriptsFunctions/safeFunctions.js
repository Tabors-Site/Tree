import axios from "axios";
import { getLandUrl } from "../../../canopy/identity.js";

import { editStatus } from "../../../core/tree/statuses.js";

// Optional extension imports (no-op if extension not installed)
let setValueForNode = async () => { throw new Error("Values extension not installed"); };
let setGoalForNode = async () => { throw new Error("Values extension not installed"); };
let addPrestige = async () => { throw new Error("Prestige extension not installed"); };
let updateSchedule = async () => { throw new Error("Schedules extension not installed"); };
try { ({ setValueForNode, setGoalForNode } = await import("../../values/core.js")); } catch {}
try { ({ addPrestige } = await import("../../prestige/core.js")); } catch {}
try { ({ updateSchedule } = await import("../../schedules/core.js")); } catch {}

async function getApi(url) {
  const blockedHosts = [
    "127.0.0.1",
    "localhost",
    "10.",
    "192.168.",
    "." + ((process.env.CREATOR_DOMAIN || process.env.ROOT_FRONTEND_DOMAIN) ? new URL(process.env.CREATOR_DOMAIN || process.env.ROOT_FRONTEND_DOMAIN).hostname : "tabors.site"),
    "." + (getLandUrl() ? new URL(getLandUrl()).hostname : "treeos.ai"),
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
