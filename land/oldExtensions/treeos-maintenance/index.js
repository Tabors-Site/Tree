// Bundle extension. No init logic. The dependency loader ensures all
// constituent extensions are installed and loaded before this one.
// This extension exists so operators can install tree maintenance
// with a single command: treeos ext install treeos-maintenance

export async function init(core) {
  return {};
}
