const Node = require("../db/models/node");
const { VM } = require("vm2");
const { getApi } = require("../controllers/scriptFunctions/safeFunctions");

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
    const sandboxNode = JSON.parse(JSON.stringify(node)); // deep copy
    const vm = new VM({
      timeout: 1000, // prevent infinite loops
      sandbox: {
        node: sandboxNode,
        getApi, // inject your restricted API call function
      },
    });

    // 4. Wrap script in async IIFE for await support
    const asyncScript = `(async () => { ${scriptObj.script} })()`;

    try {
      await vm.run(asyncScript);
    } catch (err) {
      return res
        .status(400)
        .json({ error: `Script execution failed: ${err.message}` });
    }

    // 5. Validate structure (example: prestige must be number)
    if (typeof sandboxNode.prestige !== "number") {
      return res
        .status(400)
        .json({ error: "Invalid prestige type after execution" });
    }

    // 6. Save to DB
    Object.assign(node, sandboxNode);
    await node.save();

    res.json({ message: "Script executed successfully", node });
  } catch (err) {
    console.error("Error executing script:", err);
    res.status(500).json({ error: "Server error" });
  }
};

module.exports = { updateScript, executeScript };
