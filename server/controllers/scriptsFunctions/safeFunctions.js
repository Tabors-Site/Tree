//prebuilt functions to use in scripts
const {
  setValueForNodeHelper,
  setGoalForNodeHelper,
} = require("../helpers/valuesHelper");
const {
  editStatusHelper,
  addPrestigeHelper,
} = require("../helpers/statusesHelper");

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

/**
 * Factory to build safe functions bound to a specific userId
 */
function makeSafeFunctions(userId) {
  return {
    getApi,
    setValueForNode: ({ nodeId, key, value, version }) =>
      setValueForNodeHelper({ nodeId, key, value, version, userId }),
    setGoalForNode: ({ nodeId, key, goal, version }) =>
      setGoalForNodeHelper({ nodeId, key, goal, version, userId }),
    editStatusForNode: (
      { nodeId, status, version, isInherited } //look into what isinherited does
    ) => editStatusHelper({ nodeId, status, version, isInherited, userId }),
    addPrestigeForNode: ({ nodeId }) => addPrestigeHelper({ nodeId, userId }),
  };
}

module.exports = { makeSafeFunctions };
