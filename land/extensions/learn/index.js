import tools from "./tools.js";
import { setRunChat } from "./core.js";

export async function init(core) {
  setRunChat(core.llm.runChat);

  const { default: router } = await import("./routes.js");

  return {
    router,
    tools,
  };
}
