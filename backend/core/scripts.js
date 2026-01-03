import { VM } from "vm2";
import Node from "../db/models/node.js";
import { logContribution } from "../db/utils.js";
import Contribution from "../db/models/contribution.js";

import { makeSafeFunctions } from "./scriptsFunctions/safeFunctions.js";

export async function updateScript({ nodeId, scriptId, name, script, userId }) {
  const isCreating = !scriptId;

  // ---------------------------------------------------------
  // Validate inputs
  // ---------------------------------------------------------
  if (isCreating && !name) {
    throw new Error("Name is required when creating a new script");
  }

  if (!isCreating && script === undefined && name === undefined) {
    throw new Error("Nothing to update");
  }

  // Normalize script (allow empty ONLY on creation)
  let finalScript = "";

  if (script !== undefined) {
    if (typeof script !== "string") {
      throw new Error("Script must be a string");
    }

    finalScript = script.trim();

    if (!isCreating) {
      if (!finalScript) {
        throw new Error("Script cannot be empty");
      }

      if (finalScript.length > 2000) {
        throw new Error("Script is too long (max 2000 chars)");
      }
    }
  }

  // ---------------------------------------------------------
  // Load node
  // ---------------------------------------------------------
  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found by that ID");
  }

  let targetScript;

  // ---------------------------------------------------------
  // Update existing script
  // ---------------------------------------------------------
  if (scriptId) {
    targetScript = node.scripts.id(scriptId);
    if (!targetScript) {
      throw new Error("Script not found by that ID");
    }

    if (name !== undefined) {
      targetScript.name = name;
    }

    if (script !== undefined) {
      targetScript.script = finalScript;
    }
  }

  // ---------------------------------------------------------
  // Create new script (empty allowed)
  // ---------------------------------------------------------
  else {
    targetScript = node.scripts.create({
      name,
      script: finalScript, // may be ""
    });

    node.scripts.push(targetScript);
  }

  // ---------------------------------------------------------
  // Persist
  // ---------------------------------------------------------
  await node.save();

  // ---------------------------------------------------------
  // Log contribution
  // ---------------------------------------------------------
  await logContribution({
    userId,
    nodeId,
    action: "editScript",
    nodeVersion: node.prestige.toString(),
    editScript: {
      scriptId: targetScript._id,
      scriptName: targetScript.name,
      contents: finalScript || null,
    },
  });

  return {
    message: isCreating
      ? "Script created successfully"
      : "Script updated successfully",
    scriptId: targetScript._id,
    node,
  };
}

export async function executeScript({ nodeId, scriptId, userId }) {
  if (!nodeId || !scriptId || !userId) {
    throw new Error("Missing required fields: nodeId, scriptId, or userId");
  }

  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }

  const scriptObj = node.scripts.id(scriptId);
  if (!scriptObj) {
    throw new Error("Script not found");
  }

  const scriptName = scriptObj.name;

  const sandboxNode = JSON.parse(JSON.stringify(node));
  const safeFns = makeSafeFunctions(userId);
  const logs = [];

  const vm = new VM({
    timeout: 3000,
    sandbox: {
      node: sandboxNode,
      ...safeFns,
      console: {
        log: (...args) => {
          logs.push(
            args
              .map((a) =>
                typeof a === "string" ? a : JSON.stringify(a, null, 2)
              )
              .join(" ")
          );
        },
      },
    },
  });

  try {
    await vm.run(`
      (async () => {
        ${scriptObj.script}
      })()
    `);

    await logContribution({
      userId,
      nodeId,
      action: "executeScript",
      nodeVersion: node.prestige.toString(),
      executeScript: {
        scriptId,
        scriptName,
        logs,
        success: true,
      },
    });
  } catch (err) {
    await logContribution({
      userId,
      nodeId,
      action: "executeScript",
      nodeVersion: node.prestige.toString(),
      executeScript: {
        scriptId,
        scriptName,
        logs,
        success: false,
        error: err.message,
      },
    });
    throw err;
  }

  return {
    message: "Script executed successfully",
    logs,
    node,
  };
}

export async function getScript({ nodeId, scriptId }) {
  const node = await Node.findById(nodeId);
  if (!node) throw new Error("Node not found");

  const scriptObj = node.scripts.id(scriptId);
  if (!scriptObj) throw new Error("Script not found");

  const contributions = await Contribution.find({
    nodeId,
    action: "editScript",
    "editScript.scriptId": scriptId, // ✅ key fix
  })
    .sort({ date: -1 })
    .lean();
  console.log(contributions);
  return {
    script: {
      id: scriptObj._id,
      name: scriptObj.name,
      script: scriptObj.script,
    },
    contributions: contributions.map((c) => ({
      userId: c.userId,
      nodeVersion: c.nodeVersion,
      scriptName: c.editScript?.scriptName,
      contents: c.editScript?.contents,
      createdAt: c.date,
    })),
  };
}
