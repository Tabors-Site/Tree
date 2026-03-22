import router from "./routes.js";
import tools from "./tools.js";

export async function init(core) {
  return { router, tools };
}
