import type { ContentBlock, MessageEntry } from "./types.js";

/** Flatten a message's content blocks into plain text + tool names.
 *  Used both at index time and at snippet-render time. */
export function flattenMessage(content: MessageEntry["message"]["content"]): {
  text: string;
  tools: string[];
} {
  if (typeof content === "string") return { text: content, tools: [] };
  if (!Array.isArray(content)) return { text: "", tools: [] };

  const parts: string[] = [];
  const tools: string[] = [];

  for (const block of content) {
    if (!block || typeof block !== "object") continue;
    switch (block.type) {
      case "text":
        if (typeof block.text === "string") parts.push(block.text);
        break;
      case "thinking":
        if (typeof block.thinking === "string") parts.push(block.thinking);
        break;
      case "toolUse":
      case "tool_use": {
        const name = block.name ?? block.toolName;
        if (name) tools.push(name);
        if (block.input && typeof block.input === "object") {
          try {
            parts.push(JSON.stringify(block.input));
          } catch {
            // non-serializable input — skip
          }
        }
        break;
      }
      case "toolResult":
      case "tool_result":
        parts.push(flattenToolResult(block.content));
        break;
    }
  }

  return { text: parts.join("\n"), tools };
}

function flattenToolResult(
  content: Extract<
    ContentBlock,
    { type: "toolResult" | "tool_result" }
  >["content"],
): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const b of content) {
    if (b && typeof b === "object" && typeof b.text === "string") {
      parts.push(b.text);
    }
  }
  return parts.join("\n");
}
