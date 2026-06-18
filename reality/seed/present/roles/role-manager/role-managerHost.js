// role-managerHost.js — host-escape glue for the role-manager `.word` slices
// (set-world-signal, the world-signal publish). Wires the SAME primitives the JS
// handler in ops.js calls into ctx.env.host: the kebab-case validators, the value
// coercion, and the reality-root set-space emit. NO reimplementation — only the
// env adapter the `.word` reaches. callHost invokes each as `fn({ args: [...] }, ctx)`.
// All are now pure computes / reads (NO fact): the kebab validators, the value coercion,
// the dynamic field-path, and the reality-root id. The WORLD write is the `.word`'s
// targeted `set the space root's $field to $value` (the one do:set-space).
import { NS_SEGMENT_RE, parseSignalValue } from "./ops.js";
import { getSpaceRootId } from "../../../sprout.js";

export function roleManagerHostEnv() {
  return {
    // namespace gate: a single kebab-case segment (the SAME NS_SEGMENT_RE the JS uses).
    "valid-namespace": ({ args: [namespace] }) => {
      const ns = String(namespace || "").trim();
      return !!ns && NS_SEGMENT_RE.test(ns);
    },
    // key gate: a dotted path, every segment kebab-case (the SAME check the JS does).
    "valid-key": ({ args: [key] }) => {
      const k = String(key || "").trim();
      if (!k) return false;
      return k.split(".").map((s) => s.trim()).every((p) => NS_SEGMENT_RE.test(p));
    },
    // value coercion: the SAME parseSignalValue (JSON / bare-number / true|false|null).
    "parse-signal-value": ({ args: [value] }) => parseSignalValue(value),
    // signal-field(ns, key) → the dynamic dotted field path qualities.world.<ns>.<key>,
    // a pure compute (NO fact). The `.word` feeds it as the $-ref field of a targeted
    // set-space on the reality root, so the dynamic path is a perceived value, not a host
    // write. (Same path the JS handler built.)
    "signal-field": ({ args: [namespace, key] }) => {
      const ns = String(namespace || "").trim();
      const keyParts = String(key || "").split(".").map((s) => s.trim());
      return `qualities.world.${ns}.${keyParts.join(".")}`;
    },
    // reality-root() → the reality-root space id (a read), or null when it isn't planted
    // (the `.word` refuses INTERNAL on absence, mirroring the JS throw). The write itself
    // is the `.word`'s `set the space root's $field to $value`.
    "reality-root": () => {
      const r = getSpaceRootId();
      return r ? String(r) : null;
    },
  };
}
