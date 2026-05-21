/**
 * Blocking syntax error facet.
 *
 * Only injects when enrichedContext.blockingSyntaxError is populated —
 * i.e., the project has at least one file that still fails to parse.
 * The write gate in workspace-add-file / workspace-edit-file will
 * REJECT any write that targets a different file, so the AI must
 * fix the broken one before anything else can move.
 *
 * Surfacing this at prompt time (not just at tool-rejection time)
 * prevents wasted generation: without this facet the AI composes an
 * entire next file, submits it, and THEN gets the rejection — burning
 * thousands of tokens per blocked turn. With the facet, the AI reads
 * the red banner first and routes its next tool call to fixing the
 * broken file.
 */
export default {
  name: "blocking-error",

  shouldInject(ctx) {
    return !!ctx?.enrichedContext?.blockingSyntaxError;
  },

  text: `=================================================================
🔴 BLOCKING SYNTAX ERROR — FIX THIS FILE BEFORE ANYTHING ELSE
=================================================================

A file in this project is failing to parse. The write gate will
REJECT every workspace-add-file / workspace-edit-file call that
targets a DIFFERENT file until this one parses cleanly.

Do NOT compose content for any other file this turn. Do NOT advance
your plan to the next step. Do NOT start a new test. The only
productive action you can take right now is to rewrite the broken
file.

Your next tool call MUST be:

  1. workspace-read-file <broken file path>  — read it to see the
     exact lines that are broken. (Optional if you already know.)
  2. workspace-add-file <broken file path> with FULL corrected
     content. A full rewrite beats chained edits — line offsets
     drift after the broken bytes, so splice edits will fail.

The broken file details are in the "blockingSyntaxError" context
key above. When it parses, the block clears automatically and you
can resume your normal plan.`,
};
