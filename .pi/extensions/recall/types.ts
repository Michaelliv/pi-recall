/** pi session JSONL entry shapes we care about. Matches pi-coding-agent v3. */

export const SUPPORTED_SESSION_VERSIONS = [3] as const;

export interface SessionHeader {
  type: "session";
  version?: number;
  id: string;
  timestamp: string;
  cwd: string;
}

export type ContentBlock =
  | { type: "text"; text: string }
  | { type: "thinking"; thinking: string }
  | {
      type: "toolUse" | "tool_use";
      name?: string;
      toolName?: string;
      input?: unknown;
    }
  | {
      type: "toolResult" | "tool_result";
      content?: string | Array<{ type?: string; text?: string }>;
    };

export interface MessageEntry {
  type: "message";
  id: string;
  timestamp: string;
  message: {
    role: "user" | "assistant";
    content: string | ContentBlock[];
  };
}

export type RawFileEntry =
  | SessionHeader
  | MessageEntry
  | { type: string; [k: string]: unknown };

/** A searchable turn. Only `text` and `toolNames` are indexed fields;
 *  everything else is stored for display/filtering. */
export interface TurnDoc {
  id: number;
  sessionId: string;
  sessionPath: string;
  cwd: string;
  entryId: string;
  role: "user" | "assistant";
  timestamp: string;
  line: number;
  text: string;
  toolNames: string;
}

/** Sidecar metadata. Small: no doc text, only the reverse map
 *  `sessionPath -> docIds` plus fingerprints and cached recency range. */
export interface Meta {
  version: 1;
  files: Record<string, { size: number; mtimeMs: number; docIds: number[] }>;
  nextId: number;
  recency: { minT: number; maxT: number };
}
