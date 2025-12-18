import {
  updateScript as coreUpdateScript,
  executeScript as coreExecuteScript,
} from "../core/scripts.js";

async function updateScript(req, res) {
  try {
    const { nodeId, name, script } = req.body;

    const result = await coreUpdateScript({
      nodeId,
      name,
      script,
      userId: req.userId,
    });

    res.json(result);
  } catch (err) {
    console.error("updateScript error:", err);

    if (err.message.includes("required") || err.message.includes("too long")) {
      return res.status(400).json({ error: err.message });
    }

    if (err.message.includes("not found")) {
      return res.status(404).json({ error: err.message });
    }

    res.status(500).json({ error: "Server error" });
  }
}

const executeScript = async (req, res) => {
  try {
    const { nodeId, scriptName } = req.body;
    const userId = req.userId;

    const result = await coreExecuteScript({ nodeId, scriptName, userId });
    res.json(result);
  } catch (err) {
    console.error("Error executing script:", err);
    res.status(500).json({ error: err.message });
  }
};

export { updateScript, executeScript };
