/**
 * Incremental index builder.
 *
 * Walks $PI_CODING_AGENT_DIR/sessions/<project>/*.jsonl, diffs against
 * meta.files (size+mtime), and re-indexes changed/new files. One doc per
 * user|assistant message turn. Text + tool names are the only indexed
 * fields; everything else is stored for display/filtering.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { loadIndex, SESSIONS_DIR, saveIndex } from "./index-store.js";
import { flattenMessage } from "./parse.js";
import {
  type Meta,
  type RawFileEntry,
  SUPPORTED_SESSION_VERSIONS,
  type TurnDoc,
} from "./types.js";

function listSessionFiles(root: string = SESSIONS_DIR): string[] {
  if (!fs.existsSync(root)) return [];
  const out: string[] = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const dir = path.join(root, entry.name);
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".jsonl")) out.push(path.join(dir, f));
    }
  }
  return out;
}

function parseLine(line: string): RawFileEntry | null {
  if (!line) return null;
  try {
    return JSON.parse(line) as RawFileEntry;
  } catch {
    return null;
  }
}

interface IndexFileResult {
  docs: TurnDoc[];
  /** IDs of docs previously attributed to this file, now superseded. */
  removedIds: number[];
}

function indexFile(
  file: string,
  meta: Meta,
  assignId: () => number,
): IndexFileResult | null {
  const prev = meta.files[file];
  const removedIds = prev ? [...prev.docIds] : [];

  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }

  const lines = raw.split("\n");
  const docs: TurnDoc[] = [];
  let sessionId = "";
  let cwd = "";
  let headerSeen = false;

  for (let i = 0; i < lines.length; i++) {
    const entry = parseLine(lines[i]);
    if (!entry) continue;

    if (entry.type === "session") {
      const v = (entry as { version?: number }).version ?? 1;
      if (!SUPPORTED_SESSION_VERSIONS.includes(v as 3)) {
        // Unknown session format — skip the file rather than mis-parse.
        return { docs: [], removedIds };
      }
      sessionId = (entry as { id?: string }).id ?? "";
      cwd = (entry as { cwd?: string }).cwd ?? "";
      headerSeen = true;
      continue;
    }

    if (!headerSeen) continue;
    if (entry.type !== "message") continue;

    const msg = (entry as { message?: { role?: string; content?: unknown } })
      .message;
    if (!msg || (msg.role !== "user" && msg.role !== "assistant")) continue;

    const { text, tools } = flattenMessage(
      msg.content as Parameters<typeof flattenMessage>[0],
    );
    if (!text.trim() && tools.length === 0) continue;

    docs.push({
      id: assignId(),
      sessionId,
      sessionPath: file,
      cwd,
      entryId: (entry as { id?: string }).id ?? "",
      role: msg.role,
      timestamp: (entry as { timestamp?: string }).timestamp ?? "",
      line: i + 1,
      text,
      toolNames: tools.join(" "),
    });
  }

  return { docs, removedIds };
}

export interface BuildProgress {
  processed: number;
  total: number;
  changed: number;
  file?: string;
}

export interface BuildResult {
  files: number;
  changed: number;
  docs: number;
  durationMs: number;
}

export function buildIndex(
  onProgress?: (p: BuildProgress) => void,
): BuildResult {
  const start = Date.now();
  const { index, meta } = loadIndex();
  const files = listSessionFiles();
  const seen = new Set(files);
  let changed = 0;

  const assignId = () => meta.nextId++;

  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    let stat: fs.Stats;
    try {
      stat = fs.statSync(file);
    } catch {
      continue;
    }

    const fp = meta.files[file];
    if (fp && fp.size === stat.size && fp.mtimeMs === stat.mtimeMs) {
      onProgress?.({ processed: i + 1, total: files.length, changed });
      continue;
    }

    const result = indexFile(file, meta, assignId);
    if (!result) {
      onProgress?.({ processed: i + 1, total: files.length, changed });
      continue;
    }

    // Remove superseded docs, then add fresh.
    for (const id of result.removedIds) index.discard(id);
    if (result.docs.length) index.addAll(result.docs);

    meta.files[file] = {
      size: stat.size,
      mtimeMs: stat.mtimeMs,
      docIds: result.docs.map((d) => d.id),
    };
    changed++;
    onProgress?.({
      processed: i + 1,
      total: files.length,
      changed,
      file,
    });
  }

  // Prune files that disappeared from disk.
  for (const known of Object.keys(meta.files)) {
    if (seen.has(known)) continue;
    for (const id of meta.files[known].docIds) index.discard(id);
    delete meta.files[known];
    changed++;
  }

  // Precompute recency range for search-time boost.
  updateRecency(meta);

  saveIndex(index, meta);
  return {
    files: files.length,
    changed,
    docs: index.documentCount,
    durationMs: Date.now() - start,
  };
}

function updateRecency(meta: Meta) {
  // MiniSearch doesn't expose stored fields in bulk, so walk our file map.
  // Instead of parsing every timestamp, we trust session file mtime as a
  // proxy for "most recent turn" — accurate enough for a boost.
  let minT = Number.POSITIVE_INFINITY;
  let maxT = Number.NEGATIVE_INFINITY;
  for (const fp of Object.values(meta.files)) {
    if (fp.mtimeMs < minT) minT = fp.mtimeMs;
    if (fp.mtimeMs > maxT) maxT = fp.mtimeMs;
  }
  if (!Number.isFinite(minT) || !Number.isFinite(maxT)) {
    meta.recency = { minT: 0, maxT: 0 };
  } else {
    meta.recency = { minT, maxT };
  }
}

export { indexFile, listSessionFiles };

// CLI entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const result = buildIndex((p) => {
    if (p.processed % 100 === 0 || p.processed === p.total) {
      process.stderr.write(
        `\r${p.processed}/${p.total} files (${p.changed} changed)`,
      );
    }
  });
  process.stderr.write("\n");
  console.log(
    `Indexed ${result.docs} turns across ${result.files} files ` +
      `(${result.changed} changed) in ${(result.durationMs / 1000).toFixed(1)}s`,
  );
}
