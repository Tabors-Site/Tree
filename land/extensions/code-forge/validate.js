/**
 * Forge validator.
 *
 * Mirror of the validation logic used by Horizon's publish route
 * (horizon/routes/extensions.js). Kept as a pure module so code-forge can
 * validate locally before publishing. The two copies need to stay in sync;
 * when they diverge, the Horizon server wins and returns an error.
 *
 * This validator runs the checks that do NOT require database access:
 * structure, format, size, paths. It does not run name-ownership,
 * typosquatting, or dependency existence checks.
 */

const NAME_RE = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
const NAME_MIN = 2;
const NAME_MAX = 50;

const RESERVED_NAMES = new Set([
  "seed", "kernel", "canopy", "horizon", "core", "land", "tree",
  "loader", "_template",
]);

const MAX_DESCRIPTION_LENGTH = 10000;
const MAX_README_LENGTH = 100000;
const MAX_TAG_LENGTH = 30;
const MAX_TAGS = 20;
const MAX_FILES = 200;
const MAX_MANIFEST_BYTES = 50000;
const MAX_TOTAL_BYTES = 3_000_000;

function parseSemver(v) {
  const m = String(v).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function validateName(name) {
  if (typeof name !== "string") return "name must be a string";
  if (name.length < NAME_MIN) return `name must be at least ${NAME_MIN} characters`;
  if (name.length > NAME_MAX) return `name must be at most ${NAME_MAX} characters`;
  if (!NAME_RE.test(name)) return "name must be lowercase alphanumeric with hyphens, start with a letter, no consecutive or trailing hyphens";
  if (RESERVED_NAMES.has(name)) return `"${name}" is a reserved name`;
  return null;
}

function validateVersion(version) {
  if (typeof version !== "string") return "version must be a string";
  if (!parseSemver(version)) return `version "${version}" is not valid semver (expected X.Y.Z)`;
  return null;
}

function validateFilePaths(files) {
  const errors = [];
  for (const file of files) {
    const p = file.path;
    if (typeof p !== "string" || p.length === 0) {
      errors.push("empty file path");
      continue;
    }
    if (p.startsWith("/") || p.startsWith("\\")) errors.push(`absolute path not allowed: "${p}"`);
    if (p.includes("..")) errors.push(`path traversal not allowed: "${p}"`);
    if (p.includes("\0")) errors.push(`null byte in path: "${p}"`);
    if (p.length > 256) errors.push(`path too long (${p.length} chars): "${p.slice(0, 40)}..."`);
  }
  return errors;
}

function validateContentLimits(manifest, files, readme, tags) {
  const errors = [];
  const manifestSize = JSON.stringify(manifest).length;
  if (manifestSize > MAX_MANIFEST_BYTES) {
    errors.push(`manifest exceeds ${MAX_MANIFEST_BYTES} bytes when serialized (got ${manifestSize})`);
  }
  if (manifest.description && manifest.description.length > MAX_DESCRIPTION_LENGTH) {
    errors.push(`description exceeds ${MAX_DESCRIPTION_LENGTH} characters`);
  }
  if (readme && readme.length > MAX_README_LENGTH) {
    errors.push(`readme exceeds ${MAX_README_LENGTH} characters`);
  }
  if (tags) {
    if (!Array.isArray(tags)) errors.push("tags must be an array");
    else {
      if (tags.length > MAX_TAGS) errors.push(`maximum ${MAX_TAGS} tags allowed`);
      for (const tag of tags) {
        if (typeof tag !== "string") errors.push("each tag must be a string");
        else if (tag.length > MAX_TAG_LENGTH) errors.push(`tag "${tag.slice(0, 10)}..." exceeds ${MAX_TAG_LENGTH} characters`);
        else if (!NAME_RE.test(tag)) errors.push(`tag "${tag}" must be lowercase alphanumeric with hyphens`);
      }
    }
  }
  if (files.length > MAX_FILES) errors.push(`maximum ${MAX_FILES} files allowed (got ${files.length})`);
  const totalBytes = files.reduce((s, f) => s + (f.content?.length || 0), 0);
  if (totalBytes > MAX_TOTAL_BYTES) errors.push(`total file size exceeds ${MAX_TOTAL_BYTES} bytes (got ${totalBytes})`);
  return errors;
}

/**
 * Run all local checks that do not need DB access.
 * Returns { valid: boolean, errors: string[], warnings: string[] }.
 */
export function validateExtensionPackage({ manifest, files, readme, tags }) {
  const errors = [];
  const warnings = [];

  if (!manifest || typeof manifest !== "object") {
    errors.push("manifest is required");
    return { valid: false, errors, warnings };
  }
  if (!manifest.name) errors.push("manifest.name is required");
  if (!manifest.version) errors.push("manifest.version is required");

  if (manifest.name) {
    const nameErr = validateName(manifest.name);
    if (nameErr) errors.push(nameErr);
  }
  if (manifest.version) {
    const versionErr = validateVersion(manifest.version);
    if (versionErr) errors.push(versionErr);
  }

  if (!Array.isArray(files) || files.length === 0) {
    errors.push("files array is required (at least manifest.js)");
  } else {
    const filePaths = new Set(files.map((f) => f.path));
    if (!filePaths.has("manifest.js")) errors.push("manifest.js is required in files");

    const pkgType = ["extension", "bundle", "os"].includes(manifest.type) ? manifest.type : "extension";
    if (pkgType === "extension" && !filePaths.has("index.js")) {
      errors.push("index.js is required in files for extensions");
    }

    errors.push(...validateFilePaths(files));
    errors.push(...validateContentLimits(manifest, files, readme, tags));
  }

  if (!manifest.description) warnings.push("manifest has no description");
  if (!manifest.builtFor) warnings.push("manifest has no builtFor field (defaults to 'seed')");

  return { valid: errors.length === 0, errors, warnings };
}

export { NAME_RE, RESERVED_NAMES };
