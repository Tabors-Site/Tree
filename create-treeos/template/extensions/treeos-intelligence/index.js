// Bundle extension. No init logic. The dependency loader ensures all
// constituent extensions are installed and loaded before this one.
// This extension exists so operators can install the entire intelligence
// suite with a single command: treeos ext install treeos-intelligence

export async function init(core) {
  return {};
}
