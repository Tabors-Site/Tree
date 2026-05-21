// Gateway channel type registry.
// Channel extensions (gateway-discord, gateway-telegram, gateway-webhook)
// register their handlers here during init(). The gateway core delegates
// validation, encryption, dispatch, and lifecycle to the registered handler.
//
// Handler shape:
// {
//   allowedDirections: ["input", "output", "input-output"],
//   validateConfig(config, direction),
//   buildEncryptedConfig(config, direction) -> { secrets, metadata, displayIdentifier? },
//   send(secrets, metadata, notification),
//   registerInput?(channel, secrets),
//   unregisterInput?(channel, secrets),
//   requiredTiers?: ["standard", "premium"],  // for input channels, null = no restriction
// }

const types = new Map();

export function registerChannelType(typeName, handler) {
  if (!typeName || typeof typeName !== "string") {
    throw new Error("Channel type name must be a non-empty string");
  }
  if (!handler || typeof handler !== "object") {
    throw new Error("Channel type handler must be an object");
  }
  if (!handler.validateConfig || typeof handler.validateConfig !== "function") {
    throw new Error(`Handler for "${typeName}" must provide validateConfig(config, direction)`);
  }
  if (!handler.buildEncryptedConfig || typeof handler.buildEncryptedConfig !== "function") {
    throw new Error(`Handler for "${typeName}" must provide buildEncryptedConfig(config, direction)`);
  }
  if (!handler.send || typeof handler.send !== "function") {
    throw new Error(`Handler for "${typeName}" must provide send(secrets, metadata, notification)`);
  }
  if (!Array.isArray(handler.allowedDirections) || handler.allowedDirections.length === 0) {
    throw new Error(`Handler for "${typeName}" must provide allowedDirections array`);
  }
  types.set(typeName, handler);
}

export function getChannelType(typeName) {
  return types.get(typeName);
}

export function getRegisteredTypes() {
  return [...types.keys()];
}

export function hasChannelType(typeName) {
  return types.has(typeName);
}
