export async function init(core) {
  const { setModels, setMetadata } = await import("./core.js");
  setModels(core.models);
  setMetadata(core.metadata);
  const { default: router } = await import("./routes.js");
  return { router };
}
