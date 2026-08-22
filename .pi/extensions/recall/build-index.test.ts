import { strict as assert } from "node:assert";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { test } from "node:test";
import { indexFile } from "./build-index.js";
import type { Meta } from "./types.js";

function emptyMeta(): Meta {
  return { version: 1, files: {}, nextId: 1, recency: { minT: 0, maxT: 0 } };
}

function mkTmp(contents: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "recall-test-"));
  const file = path.join(dir, "session.jsonl");
  fs.writeFileSync(file, contents);
  return file;
}

test("indexFile extracts user and assistant message turns", () => {
  const jsonl = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "s1",
      timestamp: "2026-01-01T00:00:00Z",
      cwd: "/tmp/proj",
    }),
    JSON.stringify({
      type: "message",
      id: "m1",
      timestamp: "2026-01-01T00:00:01Z",
      message: {
        role: "user",
        content: [{ type: "text", text: "find the bug" }],
      },
    }),
    JSON.stringify({
      type: "message",
      id: "m2",
      timestamp: "2026-01-01T00:00:02Z",
      message: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "let me grep" },
          { type: "tool_use", name: "bash", input: { cmd: "rg" } },
        ],
      },
    }),
  ].join("\n");

  const file = mkTmp(jsonl);
  const meta = emptyMeta();
  let next = 1;
  const result = indexFile(file, meta, () => next++);

  assert.ok(result);
  assert.equal(result.docs.length, 2);
  assert.equal(result.docs[0].role, "user");
  assert.equal(result.docs[0].sessionId, "s1");
  assert.equal(result.docs[0].cwd, "/tmp/proj");
  assert.equal(result.docs[0].line, 2);
  assert.equal(result.docs[1].role, "assistant");
  assert.equal(result.docs[1].toolNames, "bash");
  assert.match(result.docs[1].text, /let me grep/);
});

test("indexFile skips files with unsupported session version", () => {
  const jsonl = JSON.stringify({
    type: "session",
    version: 99,
    id: "s1",
    timestamp: "z",
    cwd: "/",
  });
  const file = mkTmp(jsonl);
  const result = indexFile(file, emptyMeta(), () => 1);
  assert.ok(result);
  assert.equal(result.docs.length, 0);
});

test("indexFile drops empty-text turns with no tools", () => {
  const jsonl = [
    JSON.stringify({
      type: "session",
      version: 3,
      id: "s",
      timestamp: "z",
      cwd: "/",
    }),
    JSON.stringify({
      type: "message",
      id: "m1",
      timestamp: "z",
      message: { role: "user", content: [] },
    }),
  ].join("\n");
  const file = mkTmp(jsonl);
  const result = indexFile(file, emptyMeta(), () => 1);
  assert.ok(result);
  assert.equal(result.docs.length, 0);
});

test("indexFile reports prior doc ids as removed (for re-index)", () => {
  const jsonl = JSON.stringify({
    type: "session",
    version: 3,
    id: "s",
    timestamp: "z",
    cwd: "/",
  });
  const file = mkTmp(jsonl);
  const meta = emptyMeta();
  meta.files[file] = { size: 0, mtimeMs: 0, docIds: [7, 8, 9] };
  const result = indexFile(file, meta, () => 1);
  assert.ok(result);
  assert.deepEqual(result.removedIds, [7, 8, 9]);
});
