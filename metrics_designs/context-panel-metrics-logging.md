# Context Panel Metrics Logging Design

## Goal

Persist Context panel metrics in a format that is easy for humans to inspect and easy for scripts or AI agents to analyze later. The logs should support analysis of token usage, cost, elapsed time, model usage, and subagent activity across projects, sessions, and OpenCode/IDE/agent restarts.

## Requirements

- Logs must persist across projects, sessions, IDE restarts, and agent restarts.
- Logs must be human-readable and AI-readable.
- Logs must include timestamps.
- Logs must include most Context panel metrics.
- Logs must include subagent information.
- Logs must exclude Context Breakdown.
- Logs must exclude Raw Messages.
- Metrics logging must be enabled by default.
- The settings UI should expose metrics logging under an `Advanced metrics` group.
- The `Advanced metrics` group should also contain follow-on controls for the same feature, starting with `Use estimates`.

## Proposed Storage

Write metrics to dedicated append-only JSON Lines files under OpenCode's global data directory, in a metrics-specific subdirectory:

```text
~/.local/share/opencode/metrics/sessions/<sessionID>.jsonl
```

Each session gets its own metrics file. Each line is one complete JSON object representing one metrics snapshot for that session. JSON Lines keeps each file append-friendly, diffable, recoverable after partial writes, and easy to process with common tools.

This structure is preferred over one global rotating log because metrics analysis is session/task-oriented. It also avoids splitting one session across multiple rotated files.

If `XDG_DATA_HOME` is set, use the same data-root behavior as the rest of OpenCode:

```text
$XDG_DATA_HOME/opencode/metrics/sessions/<sessionID>.jsonl
```

A later version can add a lightweight index for discovery:

```text
~/.local/share/opencode/metrics/index.jsonl
```

The index should not be required for correctness. Session metrics files should remain self-contained.

## Log Event Shape

Use one event per metrics snapshot.

```json
{
  "schema": "opencode.context_metrics.v1",
  "time": {
    "created": "2026-05-15T12:58:00.000Z",
    "epochMs": 1778842680000
  },
  "project": {
    "id": "proj_...",
    "directory": "/Users/alexandra/opencode",
    "workspaceID": "wrk_..."
  },
  "session": {
    "id": "ses_...",
    "title": "Example task",
    "created": 1778841000000,
    "lastActivity": 1778842680000
  },
  "context": {
    "provider": "Anthropic",
    "providerID": "anthropic",
    "model": "Claude Sonnet 4.5",
    "modelID": "claude-sonnet-4-5",
    "limit": 200000,
    "usagePercent": 42,
    "currentContextTokens": 84000,
    "inputTokens": 60000,
    "outputTokens": 12000,
    "reasoningTokens": 0,
    "cacheReadTokens": 10000,
    "cacheWriteTokens": 2000
  },
  "totals": {
    "messages": 18,
    "userMessages": 6,
    "assistantMessages": 12,
    "tokens": 124000,
    "costUsd": 1.2345,
    "executionMs": 430000
  },
  "subagents": {
    "count": 2,
    "tokens": 26000,
    "items": [
      {
        "sessionID": "ses_child_1",
        "parentSessionID": "ses_...",
        "title": "Search codebase",
        "agent": "explore",
        "depth": 1,
        "tokens": 14000,
        "executionMs": 180000
      },
      {
        "sessionID": "ses_child_2",
        "parentSessionID": "ses_...",
        "title": "Review implementation",
        "agent": "general",
        "depth": 1,
        "tokens": 12000,
        "executionMs": 90000
      }
    ]
  }
}
```

## Included Context Panel Fields

- Session title or ID.
- Optional workspace ID.
- Message counts.
- Provider label and provider ID.
- Model label and model ID.
- Total tokens.
- Total execution time.
- Model context limit.
- Current context tokens.
- Context usage percentage.
- Input tokens.
- Output tokens.
- Reasoning tokens.
- Cache read/write tokens.
- User message count.
- Assistant message count.
- Total cost.
- Session created time.
- Last activity time.
- Total subagent count.
- Subagent token total.
- Per-subagent session ID, parent session ID, nesting depth, title, agent, tokens, and execution time.

## Subagent Storage

Keep subagent metrics embedded in the parent session's metrics snapshots.

For example, metrics for parent session `ses_parent` should be written to:

```text
~/.local/share/opencode/metrics/sessions/ses_parent.jsonl
```

Each parent snapshot should include a `subagents` object with aggregate and per-subagent metrics. This keeps parent-session analysis self-contained and avoids needing to join multiple files to answer questions like “how many tokens did this task use including subagents?”

The first version should include direct subagents only. Built-in OpenCode subagents do not currently launch nested subagents by default. Each item should still include `parentSessionID` and `depth` so the schema can support nested subagents later if custom subagents or future built-in agents need it.

Child sessions can still have their own metrics files if they are opened or logged independently, but parent-level subagent summaries should remain embedded in the parent session file.

## Excluded Fields

- Context Breakdown.
- Raw Messages.
- Message parts.
- Prompt text.
- Tool inputs and outputs.
- File contents.

## Capture Point

The first implementation should log from the app side, close to `getSessionContextMetrics()` usage in `SessionContextTab`.

Reasoning:

- The Context panel already computes the branch-specific metrics there.
- Subagent metrics are currently assembled in the UI from loaded child session history.
- This avoids duplicating Context panel logic in the backend before the metric shape stabilizes.

The app should emit a metrics snapshot when all of the following are true:

- A session is selected.
- Context metrics have a current assistant message with token data, or the session has subagent metrics.
- The session is idle, so metrics are less likely to be mid-update.
- The snapshot differs from the last written snapshot for the same session.

## Write Path

Because the browser app cannot directly write to the filesystem, add a small IPC/API write path:

- Renderer computes the metrics snapshot.
- Renderer sends the snapshot to the desktop/main process or local server.
- Writer appends one JSON line to the session metrics log file.

The writer should create the `metrics/sessions` directory if needed.

## De-Duplication

Avoid writing a new line on every render.

Use a stable hash of the metrics payload excluding `time.created` and `time.epochMs`. Keep the last hash per session in memory and only append when it changes.

This preserves a timeline of meaningful changes without generating noisy duplicate logs.

## Durability

The first version should use append-only writes and should not rotate files.

Per-session files make rotation less important because file size naturally follows task/session size. If a single session file becomes large, that is useful signal for analysis and debugging. Add per-session rotation only if it becomes a real operational problem.

If rotation is needed later, it should be per session, not global, so one session is never mixed with unrelated sessions.

Potential future per-session rotation policy:

- Rotate an individual session file at 25 MB.
- Keep rotated files next to the active session file.
- Include an ordinal or UTC timestamp in rotated file names.
- Preserve session ID in every file name.

## Privacy

The log should intentionally avoid raw message content, tool input/output content, file content, and Context Breakdown details. It should record metadata and aggregate metrics only.

No additional privacy mode is needed for the prototype. Project/session names and directories can be logged because this is an experimental local feature intended for personal analysis.

## Settings

Add a new settings UI group named `Advanced metrics`.

Add a toggle named `Log usage metrics`.

Add a second toggle named `Use estimates` below `Log usage metrics`. This controls the automatic pre-execution estimation step described in `automatic-estimation-pre-execution.md`.

Behavior:

- Enabled by default.
- Controls whether metrics snapshots are written to local JSONL files.
- Estimation events should append to the same per-session JSONL files when both logging and estimates are enabled.
- Does not include a custom directory picker for the prototype.
- Does not include an `Open metrics folder` action for the prototype.

This group owns Advanced Metrics as one feature: usage snapshots now, estimates as the next step, and additional advanced metrics controls later.

## Analysis Direction

Analysis is expected to happen outside OpenCode for now. The priority is a stable, script-friendly file format rather than built-in OpenCode analysis UI.

## Open Questions

- Should non-desktop OpenCode also write these metrics through the local server?
  - Decision: Yes. Metrics logging should not depend on OpenCode Desktop.
- Should metrics be logged only when the Context panel is opened, or for every completed assistant turn?
  - Decision: Log every completed assistant turn. The Context panel does not need to be open.
- Should there be a setting to enable/disable metrics logging?
  - Decision: Yes. Add an `Advanced metrics` settings group with a `Log usage metrics` toggle. Enable it by default.
- Should users be able to choose the metrics log directory?
  - Decision: No for the prototype. Use OpenCode's standard data directory with the metrics-specific subdirectory.
- Should the settings UI include an `Open metrics folder` button?
  - Decision: No for the prototype.
- Should logs include project/session names and directories by default?
  - Decision: Yes. No separate privacy mode for the prototype.
- Should OpenCode include built-in analysis UI for these metrics?
  - Decision: Not for now. Optimize the file format for external analysis.
- Should logs include workspace IDs once workspace behavior is finalized?
  - Answer: A workspace ID is OpenCode's identifier for a workspace routing context. It is stored on sessions as `workspaceID` / `workspace_id` and is used by experimental workspace routing to associate sessions and requests with a local or remote workspace target. Including it can help distinguish the same project/session data when routed through different workspace contexts.
  - Decision: Include `workspaceID` when available, but keep it optional.
- Should subagent metrics include only direct subagents, or recursively include nested subagents?
  - Answer: OpenCode represents subagents as child sessions through `parentID` / `parent_id`. Nested subagents are structurally possible, but built-in subagents do not currently launch nested subagents by default.
  - Decision: Include direct subagents only in v1. Preserve `parentSessionID` and `depth` in the logged subagent items so recursive support can be added later without changing the schema shape.
