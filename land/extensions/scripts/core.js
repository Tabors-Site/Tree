import vm from "node:vm";
import { v4 as uuidv4 } from "uuid";
import Node from "../../seed/models/node.js";
import { logContribution } from "../../seed/utils.js";
import Contribution from "../../seed/models/contribution.js";
import { getExtMeta, setExtMeta } from "../../seed/tree/extensionMetadata.js";

let useEnergy = async () => ({ energyUsed: 0 });
export function setEnergyService(energy) { useEnergy = energy.useEnergy; }

import { makeSafeFunctions } from "./scriptsFunctions/safeFunctions.js";

function getScripts(node) {
  const meta = getExtMeta(node, "scripts");
  return Array.isArray(meta.list) ? meta.list : [];
}

async function setScripts(node, list) {
  await setExtMeta(node, "scripts", { list });
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
  chatId = null,
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
  if (node.systemRole) throw new Error("Cannot modify system nodes");

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
    chatId,
    sessionId,
    action: "editScript",
    nodeVersion: "0",
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
  chatId = null,
  sessionId = null,
}) {
  if (!nodeId || !scriptId || !userId) {
    throw new Error("Missing required fields: nodeId, scriptId, or userId");
  }

  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }
  if (node.systemRole) throw new Error("Cannot modify system nodes");

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

  const sandbox = {
    node: sandboxNode,
    ...safeFns,
    console: {
      log: (...args) => {
        if (logs.length < 200) {
          logs.push(
            args
              .map((a) =>
                typeof a === "string" ? a : JSON.stringify(a, null, 2),
              )
              .join(" "),
          );
        }
      },
    },
    // Async support: expose Promise so async/await works in the sandbox
    Promise,
    setTimeout: (fn, ms) => setTimeout(fn, Math.min(ms, 3000)),
  };

  const context = vm.createContext(sandbox);

  const wrappedScript = `
    (async () => {
      ${scriptObj.script}
    })()
  `;

  const SCRIPT_TIMEOUT_MS = 5000;

  try {
    const script = new vm.Script(wrappedScript, { filename: `script:${scriptObj.name}` });
    const resultPromise = script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });
    // The script returns a Promise (async IIFE). Race it against a timeout.
    await Promise.race([
      resultPromise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error("Script timed out (5s)")), SCRIPT_TIMEOUT_MS)
      ),
    ]);

    await logContribution({
      userId,
      nodeId,
      wasAi,
      chatId,
      sessionId,
      action: "executeScript",
      nodeVersion: "0",
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
      chatId,
      sessionId,
      action: "executeScript",
      nodeVersion: "0",
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
