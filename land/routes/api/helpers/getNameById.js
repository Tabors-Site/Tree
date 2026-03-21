import Node from "../../../db/models/node.js";
export default async function getNodeName(nodeId) {
  const doc = await Node.findById(nodeId, "name").lean();
  return doc?.name || null;
}
