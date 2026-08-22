import { strict as assert } from "node:assert";
import { test } from "node:test";
import { flattenMessage } from "./parse.js";

test("string content passes through", () => {
  const r = flattenMessage("hello world");
  assert.equal(r.text, "hello world");
  assert.deepEqual(r.tools, []);
});

test("text + thinking blocks concatenate", () => {
  const r = flattenMessage([
    { type: "thinking", thinking: "hmm" },
    { type: "text", text: "answer" },
  ]);
  assert.equal(r.text, "hmm\nanswer");
});

test("tool_use collects name and stringifies input", () => {
  const r = flattenMessage([
    { type: "tool_use", name: "bash", input: { cmd: "ls" } },
  ]);
  assert.deepEqual(r.tools, ["bash"]);
  assert.match(r.text, /"cmd":"ls"/);
});

test("toolUse (camelCase) also works", () => {
  const r = flattenMessage([
    { type: "toolUse", toolName: "edit", input: { file: "a.ts" } },
  ]);
  assert.deepEqual(r.tools, ["edit"]);
});

test("tool_result with string content", () => {
  const r = flattenMessage([
    { type: "tool_result", content: "hello from tool" },
  ]);
  assert.equal(r.text, "hello from tool");
});

test("tool_result with block array", () => {
  const r = flattenMessage([
    {
      type: "tool_result",
      content: [
        { type: "text", text: "line one" },
        { type: "text", text: "line two" },
      ],
    },
  ]);
  assert.equal(r.text, "line one\nline two");
});

test("unknown block types are skipped", () => {
  const r = flattenMessage([
    { type: "text", text: "keep" },
    // @ts-expect-error unknown block
    { type: "weird", data: 1 },
  ]);
  assert.equal(r.text, "keep");
});

test("empty array returns empty", () => {
  const r = flattenMessage([]);
  assert.equal(r.text, "");
  assert.deepEqual(r.tools, []);
});
