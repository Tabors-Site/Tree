import Node from '../db/models/node.js';
import { VM } from 'vm2';
import { makeSafeFunctions } from './scriptsFunctions/safeFunctions.js';

const updateScript = async (req, res) => {
  try {
    const { nodeId, name, script } = req.body;

    // 1. Basic validation
    if (!name || !script) {
      return res
        .status(400)
        .json({ error: "Both name and script are required" });
    }

    if (script.length > 2000) {
      return res
        .status(400)
        .json({ error: "Script is too long (max 2000 chars)" });
    }

    // 2. Find node
    const node = await Node.findById(nodeId);
    if (!node)
      return res.status(404).json({ error: "Node not found by that ID" });

    // 3. Find existing script
    const existingScript = node.scripts.find((s) => s.name === name);

    if (existingScript) {
      // Update existing script
      existingScript.script = script;
    } else {
      // Add new script
      node.scripts.push({ name, script });
    }

    // 4. Save
    await node.save();

    return res.json({ message: "Script saved successfully", node });
  } catch (err) {
    console.error("Error in updateScript:", err);
    res.status(500).json({ error: "Server error" });
  }
};

const executeScript = async (req, res) => {
  try {
    const { nodeId, scriptName } = req.body;
    const userId = req.userId;
    // Validate input
    if (!nodeId || !scriptName || !userId) {
      return res.status(400).json({ error: "Missing required fields" });
    }

    // 1. Find node
    const node = await Node.findById(nodeId);
    if (!node) {
      return res.status(404).json({ error: "Node not found" });
    }

    // 2. Find script by name
    const scriptObj = node.scripts.find((s) => s.name === scriptName);
    if (!scriptObj) {
      return res.status(404).json({ error: "Script not found" });
    }

    // 3. Prepare sandbox
    const sandboxNode = JSON.parse(JSON.stringify(node)); // Deep copy
    const {
      getApi,
      setValueForNode,
      setGoalForNode,
      editStatusForNode,
      addPrestigeForNode,
      updateScheduleForNode,
    } = makeSafeFunctions(userId);

    const vm = new VM({
      timeout: 3000, // Prevent infinite loops
      sandbox: {
        node: sandboxNode,
        getApi,
        setValueForNode,
        setGoalForNode,
        editStatusForNode,
        addPrestigeForNode,
        updateScheduleForNode,
      },
    });
    const wrappedScript = `
  (async () => {
    ${scriptObj.script}
  })()
`;

    // 5. Execute script
    await vm.run(wrappedScript);

    // 6. Return success response
    res.json({ message: "Script executed successfully", node });
  } catch (err) {
    console.error("Error executing script:", err);
    res.status(500).json({ error: `Server error: ${err.message}` });
  }
};

export { updateScript, executeScript };
