import * as fs from "node:fs";
import { loadIndex } from "./index-store.js";
import { flattenMessage } from "./parse.js";

export interface RecallHit {
  sessionId: string;
  sessionPath: string;
  cwd: string;
  role: "user" | "assistant";
  timestamp: string;
  line: number;
  score: number;
  snippet: string;
  toolNames?: string;
}

export interface RecallOptions {
  limit?: number;
  /** Case-sensitive substring match against session cwd. */
  cwd?: string;
  role?: "user" | "assistant";
  snippetChars?: number;
}

const RECENCY_WEIGHT = 0.5;
const DEFAULT_LIMIT = 20;
const DEFAULT_SNIPPET_CHARS = 240;

export function recall(query: string, opts: RecallOptions = {}): RecallHit[] {
  let loaded: ReturnType<typeof loadIndex>;
  try {
    loaded = loadIndex();
  } catch {
    return [];
  }

  const { index, meta } = loaded;
  let raw: ReturnType<typeof index.search>;
  try {
    raw = index.search(query);
  } catch {
    // A single bad serialized index should not crash the agent. The next
    // session_start/reindex can rebuild it; until then recall just misses.
    return [];
  }

  const limit = opts.limit ?? DEFAULT_LIMIT;
  const snippetChars = opts.snippetChars ?? DEFAULT_SNIPPET_CHARS;
  const { minT, maxT } = meta.recency;
  const range = maxT - minT || 1;

  const hits: RecallHit[] = [];
  for (const r of raw) {
    // Stored fields come back directly on the search result.
    const stored = r as unknown as {
      id: number;
      score: number;
      sessionId: string;
      sessionPath: string;
      cwd: string;
      role: "user" | "assistant";
      timestamp: string;
      line: number;
      toolNames: string;
    };
    if (opts.cwd && !stored.cwd.includes(opts.cwd)) continue;
    if (opts.role && stored.role !== opts.role) continue;

    // Recency proxy from file mtime (cached in meta).
    const fileMtime = meta.files[stored.sessionPath]?.mtimeMs ?? minT;
    const recency = (fileMtime - minT) / range;
    const score = stored.score + recency * RECENCY_WEIGHT;

    hits.push({
      sessionId: stored.sessionId,
      sessionPath: stored.sessionPath,
      cwd: stored.cwd,
      role: stored.role,
      timestamp: stored.timestamp,
      line: stored.line,
      score: Math.round(score * 100) / 100,
      snippet: readSnippet(
        stored.sessionPath,
        stored.line,
        query,
        snippetChars,
      ),
      toolNames: stored.toolNames || undefined,
    });

    if (hits.length >= limit * 3) break; // soft cap before sort
  }

  hits.sort((a, b) => b.score - a.score);
  return hits.slice(0, limit);
}

/** Lazily re-read the turn's text from the JSONL file and carve a snippet.
 *  Avoids duplicating every message body in meta.json. */
function readSnippet(
  sessionPath: string,
  line: number,
  query: string,
  maxChars: number,
): string {
  let text = "";
  try {
    const raw = fs.readFileSync(sessionPath, "utf-8");
    const target = raw.split("\n")[line - 1] ?? "";
    const entry = JSON.parse(target) as {
      message?: { content?: unknown };
    };
    const content = entry.message?.content;
    if (content !== undefined) {
      text = flattenMessage(
        content as Parameters<typeof flattenMessage>[0],
      ).text;
    }
  } catch {
    return "";
  }
  return sliceAroundMatch(text, query, maxChars);
}

function sliceAroundMatch(
  text: string,
  query: string,
  maxChars: number,
): string {
  if (!text) return "";
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 1);
  const lower = text.toLowerCase();

  let pos = -1;
  for (const term of terms) {
    const p = lower.indexOf(term);
    if (p !== -1) {
      pos = p;
      break;
    }
  }

  if (pos === -1) {
    return collapse(text.slice(0, maxChars));
  }

  const start = Math.max(0, pos - Math.floor(maxChars / 3));
  const end = Math.min(text.length, start + maxChars);
  const body = collapse(text.slice(start, end));
  return (start > 0 ? "…" : "") + body + (end < text.length ? "…" : "");
}

function collapse(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}
