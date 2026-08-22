# pi-recall

🧠 BM25 search over every past pi conversation.

## Install

```bash
pi install git:github.com/Michaelliv/pi-recall
```

The first session after install triggers a background index build. It is
incremental from then on — only files whose size or mtime changed are
re-parsed.

## What it does

Walks `~/.pi/agent/sessions/` — where pi stores every session as JSONL — and
builds a MiniSearch index at `~/.pi/agent/recall/` (or `$PI_CODING_AGENT_DIR/recall/`). Exposes a `recall` tool to the
agent so it can look up prior discussions, decisions, code, or errors from any
project.

**One doc per message turn.** Each indexed document is a single user or
assistant message with `{sessionPath, line, cwd, role, timestamp, text,
toolNames}`. Results point at `sessionPath:line` so you can jump straight to
the exact turn in the JSONL.

## Tool

`recall(query, limit?, cwd?, role?)`

- `query` — BM25 query string
- `limit` — default 20
- `cwd` — substring-match the session's working directory (e.g. `"pi-napkin"`
  to scope to that project's sessions)
- `role` — `"user"` or `"assistant"` to filter speaker

## Command

`/recall-reindex` — force a full rebuild.

## Index location

```
$PI_CODING_AGENT_DIR/recall/      # default: ~/.pi/agent/recall/
  index.json    # MiniSearch serialized
  meta.json     # fingerprint + stored doc metadata
```

Honors `PI_CODING_AGENT_DIR` the same way pi itself does.

## How sessions are discovered

pi stores sessions under `~/.pi/agent/sessions/<encoded-cwd>/<timestamp>_<uuid>.jsonl`.
The encoded-cwd is pi's per-project directory scheme. We read every `.jsonl`
in every subdir — header gives us `sessionId` + `cwd`, subsequent `message`
entries give us turns.

## Scoring

BM25 (MiniSearch) + recency (0–1 normalized across the corpus) × 0.5. Text
field is boosted 2× over tool names.
