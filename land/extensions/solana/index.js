export async function init(core) {
  const { setModels } = await import("./core.js");
  setModels(core.models);
  const { default: router } = await import("./routes.js");
  return { router };
}
