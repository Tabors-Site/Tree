import { VM } from "vm2";
import { v4 as uuidv4 } from "uuid";
import Node from "../../db/models/node.js";
import { logContribution } from "../../db/utils.js";
import Contribution from "../../db/models/contribution.js";
import { useEnergy } from "../../core/tree/energy.js";
import { getExtMeta, setExtMeta } from "../../core/tree/extensionMetadata.js";

import { makeSafeFunctions } from "./scriptsFunctions/safeFunctions.js";

function getScripts(node) {
  const meta = getExtMeta(node, "scripts");
  return Array.isArray(meta.list) ? meta.list : [];
}

function setScripts(node, list) {
  setExtMeta(node, "scripts", { list });
}

function findScript(scripts, scriptId) {
  return scripts.find(s => s._id === scriptId) || null;
}
function containsHtml(str) {
  return /<[a-zA-Z\/][^>]*>/.test(str);
}
export async function updateScript({
  nodeId,
  scriptId,
  name,
  script,
  userId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  const isCreating = !scriptId;

  // ---------------------------------------------------------
  // Validate inputs
  // ---------------------------------------------------------
  if (isCreating && !name) {
    throw new Error("Name is required when creating a new script");
  }

  if (name !== undefined) {
    if (typeof name !== "string" || !name.trim()) {
      throw new Error("Script name cannot be empty");
    }
    name = name.trim();
    if (name.length > 150) {
      throw new Error("Script name must be 150 characters or fewer");
    }
    if (containsHtml(name)) {
      throw new Error("Script name cannot contain HTML tags");
    }
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

  const payload = script !== undefined ? finalScript.length : 0;
  const { energyUsed } = await useEnergy({
    userId,
    action: "editScript",
    payload,
  });

  // ---------------------------------------------------------
  // Load node
  // ---------------------------------------------------------
  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found by that ID");
  }
  if (node.isSystem) throw new Error("Cannot modify system nodes");

  const scripts = getScripts(node);
  let targetScript;

  // ---------------------------------------------------------
  // Update existing script
  // ---------------------------------------------------------
  if (scriptId) {
    targetScript = findScript(scripts, scriptId);
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
    targetScript = {
      _id: uuidv4(),
      name,
      script: finalScript,
    };

    scripts.push(targetScript);
  }

  // ---------------------------------------------------------
  // Persist
  // ---------------------------------------------------------
  setScripts(node, scripts);
  await node.save();

  // ---------------------------------------------------------
  // Log contribution
  // ---------------------------------------------------------
  await logContribution({
    userId,
    nodeId,
    wasAi,
    aiChatId,
    sessionId,
    action: "editScript",
    nodeVersion: node.prestige.toString(),
    editScript: {
      scriptId: targetScript._id,
      scriptName: targetScript.name,
      contents: finalScript || null,
    },
    energyUsed,
  });

  return {
    message: isCreating
      ? "Script created successfully"
      : "Script updated successfully",
    scriptId: targetScript._id,
    node,
  };
}

export async function executeScript({
  nodeId,
  scriptId,
  userId,
  wasAi = false,
  aiChatId = null,
  sessionId = null,
}) {
  if (!nodeId || !scriptId || !userId) {
    throw new Error("Missing required fields: nodeId, scriptId, or userId");
  }

  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }
  if (node.isSystem) throw new Error("Cannot modify system nodes");

  const scripts = getScripts(node);
  const scriptObj = findScript(scripts, scriptId);
  if (!scriptObj) {
    throw new Error("Script not found");
  }
  const { energyUsed } = await useEnergy({
    userId,
    action: "executeScript",
  });

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
                typeof a === "string" ? a : JSON.stringify(a, null, 2),
              )
              .join(" "),
          );
        },
      },
    },
  });

  const wrappedScript = `
    (async () => {
      ${scriptObj.script}
    })()
  `;
  if (logs.length > 200) {
    logs.length = 200;
  }

  try {
    await vm.run(wrappedScript);

    await logContribution({
      userId,
      nodeId,
      wasAi,
      aiChatId,
      sessionId,
      action: "executeScript",
      nodeVersion: node.prestige.toString(),
      executeScript: {
        scriptId,
        scriptName,
        logs,
        success: true,
      },
      energyUsed,
    });
  } catch (err) {
    await logContribution({
      userId,
      nodeId,
      wasAi,
      aiChatId,
      sessionId,
      action: "executeScript",
      nodeVersion: node.prestige.toString(),
      executeScript: {
        scriptId,
        scriptName,
        logs,
        success: false,
        error: err.message,
      },
      energyUsed,
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

  const scripts = getScripts(node);
  const scriptObj = findScript(scripts, scriptId);
  if (!scriptObj) throw new Error("Script not found");

  const contributions = await Contribution.find({
    nodeId,
    action: { $in: ["editScript", "executeScript"] },
    $or: [
      { "editScript.scriptId": scriptId },
      { "executeScript.scriptId": scriptId },
    ],
  })
    .sort({ date: -1 })
    .lean();

  return {
    script: {
      id: scriptObj._id,
      name: scriptObj.name,
      script: scriptObj.script,
    },

    contributions: contributions
      .map((c) => {
        if (c.action === "editScript") {
          return {
            type: "edit",
            userId: c.userId,
            nodeVersion: c.nodeVersion,
            scriptName: c.editScript?.scriptName,
            contents: c.editScript?.contents,
            createdAt: c.date,
          };
        }

        if (c.action === "executeScript") {
          return {
            type: "execute",
            userId: c.userId,
            nodeVersion: c.nodeVersion,
            scriptName: c.executeScript?.scriptName,
            logs: c.executeScript?.logs || [],
            success: c.executeScript?.success,
            error: c.executeScript?.error || null,
            createdAt: c.date,
          };
        }

        return null;
      })
      .filter(Boolean),
  };
}
