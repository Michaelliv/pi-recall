import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { buildIndex } from "./build-index.js";
import { recall } from "./search.js";

export default function (pi: ExtensionAPI) {
  let indexed = false;

  pi.on("session_start", async () => {
    if (indexed) return;
    indexed = true;
    // Incremental — cheap when nothing changed. Run after the event returns.
    queueMicrotask(() => {
      try {
        buildIndex();
      } catch {
        // Search still works against the last good index.
      }
    });
  });

  pi.registerTool({
    name: "recall",
    label: "Recall",
    description:
      "Search past pi conversations across every project. BM25 over message turns (user + assistant) from ~/.pi/agent/sessions. Returns matching turns with their session path, line number, timestamp, and a snippet — use these to reconstruct prior decisions, code, or errors from earlier sessions.",
    promptSnippet: "Search past pi conversations by keyword or topic.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query (BM25, fuzzy, prefix)" }),
      limit: Type.Optional(
        Type.Number({ description: "Max results (default 20)" }),
      ),
      cwd: Type.Optional(
        Type.String({
          description:
            "Case-sensitive substring match against the session's working directory (e.g. 'pi-napkin').",
        }),
      ),
      role: Type.Optional(
        Type.Union([Type.Literal("user"), Type.Literal("assistant")], {
          description: "Filter by speaker role",
        }),
      ),
    }),
    async execute(_toolCallId, params, _signal, _onUpdate, _ctx) {
      const hits = recall(params.query, {
        limit: params.limit,
        cwd: params.cwd,
        role: params.role,
      });
      if (hits.length === 0) {
        return {
          content: [
            { type: "text", text: "No matches in past conversations." },
          ],
          details: { hits: [] },
        };
      }
      const text = hits
        .map((h) => {
          const when = h.timestamp.slice(0, 19);
          const tools = h.toolNames ? ` [${h.toolNames}]` : "";
          return (
            `**${h.role}** · ${when} · ${h.cwd}${tools}\n` +
            `  ${h.sessionPath}:${h.line}\n` +
            `  ${h.snippet}`
          );
        })
        .join("\n\n");
      return {
        content: [{ type: "text", text }],
        details: { hits },
      };
    },
  });

  pi.registerCommand("recall-reindex", {
    description: "Rebuild the recall index from pi sessions",
    handler: async (_args, ctx) => {
      const result = buildIndex();
      if (ctx.hasUI) {
        ctx.ui.notify(
          `Recall: ${result.docs} turns, ${result.changed} files changed (${(result.durationMs / 1000).toFixed(1)}s)`,
          "success",
        );
      }
    },
  });
}
