/**
 * User metadata helpers.
 * Same pattern as extensionMetadata.js but for User documents.
 * Extensions own their data in metadata. Core provides read/write only.
 * Document size guard protects against 16MB BSON limit.
 */

import { guardMetadataWrite } from "./documentGuard.js";

/**
 * Read from user metadata. Works with both Mongoose docs and .lean() plain objects.
 */
export function getUserMeta(user, key) {
  if (!user?.metadata) return {};
  const data = user.metadata instanceof Map
    ? user.metadata.get(key)
    : user.metadata?.[key];
  return data || {};
}

export function setUserMeta(user, key, data) {
  // Document size guard
  guardMetadataWrite(user, data, { documentType: "user", documentId: user._id });

  if (!user.metadata) {
    user.metadata = new Map();
  }
  if (user.metadata instanceof Map) {
    user.metadata.set(key, data);
  } else {
    user.metadata[key] = data;
  }
  if (user.markModified) user.markModified("metadata");
}
