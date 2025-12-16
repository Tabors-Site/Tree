import { VM } from "vm2";
import Node from "../db/models/node.js";
import { makeSafeFunctions } from "./scriptsFunctions/safeFunctions.js";

export async function updateScript({ nodeId, name, script }) {
  if (!name || !script) {
    throw new Error("Both name and script are required");
  }

  if (script.length > 2000) {
    throw new Error("Script is too long (max 2000 chars)");
  }

  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found by that ID");
  }

  const existingScript = node.scripts.find((s) => s.name === name);

  if (existingScript) {
    existingScript.script = script;
  } else {
    node.scripts.push({ name, script });
  }

  await node.save();

  return {
    message: "Script saved successfully",
    node,
  };
}

export async function executeScript({ nodeId, scriptName, userId }) {
  if (!nodeId || !scriptName || !userId) {
    throw new Error("Missing required fields: nodeId, scriptName, or userId");
  }

  const node = await Node.findById(nodeId);
  if (!node) {
    throw new Error("Node not found");
  }

  const scriptObj = node.scripts.find((s) => s.name === scriptName);
  if (!scriptObj) {
    throw new Error("Script not found");
  }

  //Prepare sandbox
  const sandboxNode = JSON.parse(JSON.stringify(node)); // Deep copy
  const {
    getApi,
    setValueForNode,
    setGoalForNode,
    editStatusForNode,
    addPrestigeForNode,
    updateScheduleForNode,
  } = makeSafeFunctions(userId);

  const logs = [];

  const vm = new VM({
    timeout: 3000,
    sandbox: {
      node: sandboxNode,
      getApi,
      setValueForNode,
      setGoalForNode,
      editStatusForNode,
      addPrestigeForNode,
      updateScheduleForNode,

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

  const wrappedScript = `
    (async () => {
      ${scriptObj.script}
    })()
  `;

  //Execute script safely
  await vm.run(wrappedScript);

  return {
    message: "Script executed successfully",
    logs,
    node,
  };
}
