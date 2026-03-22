// Scripts system lives in extensions/scripts/.
// These stubs prevent crashes if the extension isn't loaded.
// MCP tools for scripts should be extracted to the extension.

export async function updateScript() {
  throw new Error("Scripts extension not installed");
}

export async function executeScript() {
  throw new Error("Scripts extension not installed");
}

export async function getScript() {
  return null;
}
