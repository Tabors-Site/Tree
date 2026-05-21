// Bundle extension. No init logic. The dependency loader ensures all
// constituent extensions are installed and loaded before this one.
// This extension exists so operators can install the entire gateway
// channel suite with a single command: treeos ext install treeos-connect

export async function init(core) {
  return {};
}
