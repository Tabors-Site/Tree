import test from "node:test";
import assert from "node:assert";
import { countVowels } from "./lib.js";

test("counts vowels in lowercase string", () => {
  assert.strictEqual(countVowels("hello"), 2); // e, o
});

test("counts vowels in mixed case string", () => {
  assert.strictEqual(countVowels("Hello World"), 3); // e, o, o
});

test("counts vowels in string with no vowels", () => {
  assert.strictEqual(countVowels("rhythm"), 0);
});

test("counts vowels in empty string", () => {
  assert.strictEqual(countVowels(""), 0);
});
