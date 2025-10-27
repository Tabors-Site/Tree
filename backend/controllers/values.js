// nodeControllers.js
import {
  setValueForNode as coreSetValueForNode,
  setGoalForNode as coreSetGoalForNode,
} from "../core/values.js";

async function setValueForNode(req, res) {
  try {
    const result = await coreSetValueForNode({
      nodeId: req.body.nodeId,
      key: req.body.key,
      value: req.body.value,
      version: req.body.version,
      userId: req.userId,
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

async function setGoalForNode(req, res) {
  try {
    const result = await coreSetGoalForNode({
      nodeId: req.body.nodeId,
      key: req.body.key,
      goal: req.body.goal,
      version: req.body.version,
      userId: req.userId,
    });
    res.status(200).json(result);
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
}

export { setValueForNode, setGoalForNode };
