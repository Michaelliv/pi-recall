import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import MiniSearch from "minisearch";
import type { Meta, TurnDoc } from "./types.js";

export const AGENT_DIR =
  process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
export const RECALL_DIR = path.join(AGENT_DIR, "recall");
export const SESSIONS_DIR = path.join(AGENT_DIR, "sessions");
const INDEX_FILE = path.join(RECALL_DIR, "index.json");
const META_FILE = path.join(RECALL_DIR, "meta.json");

export const MINISEARCH_OPTS = {
  fields: ["text", "toolNames"],
  storeFields: [
    "sessionId",
    "sessionPath",
    "cwd",
    "entryId",
    "role",
    "timestamp",
    "line",
    "toolNames",
  ],
  searchOptions: {
    boost: { text: 1, toolNames: 0.5 },
    fuzzy: 0.1,
    prefix: true,
  },
  // MiniSearch's default auto-vacuum runs asynchronously after discard().
  // A malformed/corrupt session-derived index can then throw outside our
  // buildIndex() try/catch and take down the whole agent process. Recall is
  // an opportunistic memory tool, so prefer stale-but-safe over background
  // mutation. We rebuild changed files by discarding old IDs and saving a
  // compact serialized index; no background vacuum is worth the crash risk.
  autoVacuum: false,
} as const;

function emptyMeta(): Meta {
  return {
    version: 1,
    files: {},
    nextId: 1,
    recency: { minT: 0, maxT: 0 },
  };
}

function ensureDir() {
  fs.mkdirSync(RECALL_DIR, { recursive: true });
}

/** Atomic JSON write: write to tmp, fsync, rename. */
function writeAtomic(target: string, data: string) {
  const tmp = `${target}.tmp-${process.pid}`;
  const fd = fs.openSync(tmp, "w");
  try {
    fs.writeFileSync(fd, data);
    fs.fsyncSync(fd);
  } finally {
    fs.closeSync(fd);
  }
  fs.renameSync(tmp, target);
}

/** In-process cache so repeated tool calls don't reparse 60MB of JSON. */
let cache: { index: MiniSearch<TurnDoc>; meta: Meta; mtime: number } | null =
  null;

function currentMtime(): number {
  try {
    return fs.statSync(INDEX_FILE).mtimeMs;
  } catch {
    return 0;
  }
}

export function loadIndex(): { index: MiniSearch<TurnDoc>; meta: Meta } {
  ensureDir();
  const mtime = currentMtime();
  if (cache && cache.mtime === mtime && mtime > 0) {
    return { index: cache.index, meta: cache.meta };
  }
  if (fs.existsSync(INDEX_FILE) && fs.existsSync(META_FILE)) {
    try {
      const index = MiniSearch.loadJSON<TurnDoc>(
        fs.readFileSync(INDEX_FILE, "utf-8"),
        MINISEARCH_OPTS,
      );
      const meta: Meta = JSON.parse(fs.readFileSync(META_FILE, "utf-8"));
      cache = { index, meta, mtime };
      return { index, meta };
    } catch {
      // Fall through to a fresh index — corrupt files trigger a rebuild
      // on next buildIndex() call.
    }
  }
  const fresh = {
    index: new MiniSearch<TurnDoc>(MINISEARCH_OPTS),
    meta: emptyMeta(),
  };
  cache = { ...fresh, mtime: 0 };
  return fresh;
}

export function saveIndex(index: MiniSearch<TurnDoc>, meta: Meta) {
  ensureDir();
  writeAtomic(INDEX_FILE, JSON.stringify(index));
  writeAtomic(META_FILE, JSON.stringify(meta));
  cache = { index, meta, mtime: currentMtime() };
}

/** Invalidate the in-process cache. Tests and long-lived processes. */
export function resetCache() {
  cache = null;
}

export { INDEX_FILE, META_FILE };
