import log from "../../seed/log.js";
import { clean } from "./clean.js";

export async function init(core) {
  core.hooks.register("beforeResponse", async (data) => {
    if (data.content && typeof data.content === "string") {
      data.content = clean(data.content);
    }
  }, "formatting");

  log.verbose("Formatting", "Response cleaning active (emojis, whitespace, filler)");

  return {};
}
