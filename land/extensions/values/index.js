import router from "./routes.js";

export async function init(core) {
  // Register enrichContext hook so AI sees values/goals without core knowing about us
  core.hooks.register("enrichContext", async ({ context, node, meta }) => {
    const values = meta.values || {};
    const goals = meta.goals || {};
    if (Object.keys(values).length > 0) context.values = values;
    if (Object.keys(goals).length > 0) context.goals = goals;
  }, "values");

  return { router };
}
