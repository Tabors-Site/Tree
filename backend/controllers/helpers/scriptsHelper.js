import { VM } from "vm2";
import Node from "../../db/models/node.js";
import { makeSafeFunctions } from "../scriptsFunctions/safeFunctions.js";

export async function executeScriptHelper({ nodeId, scriptName, userId }) {

    if (!nodeId || !scriptName || !userId) {
        throw new Error("Missing required fields: nodeId, scriptName, or userId");
    }

    // 1. Find node
    const node = await Node.findById(nodeId);
    if (!node) {
        throw new Error("Node not found");
    }

    // 2. Find script by name
    const scriptObj = node.scripts.find((s) => s.name === scriptName);
    if (!scriptObj) {
        throw new Error("Script not found");
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
        timeout: 3000,
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

    // 4. Execute script safely
    await vm.run(wrappedScript);

    return {
        message: "Script executed successfully",
        node,
    };
}
