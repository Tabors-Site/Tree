/**
 * Compare two semver strings (e.g. "0.1.0", "1.2.3").
 * Returns -1 if a < b, 0 if equal, 1 if a > b.
 * Returns null if either string is not valid semver.
 */
export function compareSemver(a, b) {
  const pa = String(a).match(/^(\d+)\.(\d+)\.(\d+)/);
  const pb = String(b).match(/^(\d+)\.(\d+)\.(\d+)/);
  if (!pa || !pb) return null;

  for (let i = 1; i <= 3; i++) {
    const na = Number(pa[i]);
    const nb = Number(pb[i]);
    if (na < nb) return -1;
    if (na > nb) return 1;
  }
  return 0;
}
