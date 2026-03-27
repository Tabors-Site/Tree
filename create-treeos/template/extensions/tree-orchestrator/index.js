import { orchestrateTreeRequest, clearMemory } from "./orchestrator.js";
import { setClearMemoryFn } from "../../seed/ws/websocket.js";

export async function init(core) {
  // Wire orchestrator memory cleanup into the WebSocket disconnect/clear path
  setClearMemoryFn(clearMemory);

  return {
    orchestrator: {
      bigMode: "tree",
      handle: orchestrateTreeRequest,
    },
    exports: { orchestrateTreeRequest },
  };
}
