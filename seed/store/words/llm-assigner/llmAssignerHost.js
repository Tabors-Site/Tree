// TreeOS Seed . AGPL-3.0 . https://treeos.ai . Tabor Holly
//
// llmAssignerHost.js — host-escape glue for the llm-assigner set-*-llm word cluster
// (set-being-llm.word / set-space-llm.word / set-story-llm.word). ONE floor see-op NAME,
// `resolve-llm-config`, backs all three; the MODE ("being" | "space" | "story") is closed over by
// the per-op host factory (llmConfigHostEnv(mode)) — NOT a `.word` arg (see-op args are bindings,
// not string literals). So each op registers `hostEnv: () => llmConfigHostEnv("being")` etc., and
// its `.word` calls `resolve-llm-config(params, caller)` with no mode token.
//
// resolve-llm-config runs resolveLlmConfigSpec (connect.js — the home of the other resolve* floors),
// which legacy-normalizes (connectionId → connections), runs the force-flag mutex, validates the
// slot, resolves the TARGET per mode (being → the caller; space → params.spaceId after a Space.exists
// read; story → the place root after a hasHeavenAuthority gate), and BUILDS the { field, value }
// write list. It emits NO fact — it RETURNS { targetKind, targetId, writes } and the `.word` fans
// each write out as its own do:set-being / do:set-space deed (its own moment via runWordToStore).
// The host throws the SAME IbpErrors the handlers threw; a host throw becomes the `.word`'s refusal.
//
// callHost invokes the escape as `fn({ args: [...] }, ctx)`.

// llmConfigHostEnv(mode) — the per-op host factory. `mode` is fixed at registration; the `.word`
// passes only (params, caller).
export function llmConfigHostEnv(mode) {
  return function () {
    return {
      "resolve-llm-config": async ({ args: [params, caller] }) => {
        const { resolveLlmConfigSpec } = await import(
          "../../cognition/llm/connect.js"
        );
        const actor = caller != null ? String(caller) : null;
        return resolveLlmConfigSpec(String(mode), params || {}, actor);
      },
    };
  };
}
