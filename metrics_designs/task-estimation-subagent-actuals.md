# Task Estimation Subagent Actuals Design

## Goal

Improve task estimation logs so subagent usage can be compared against predictions. The current logs record whether subagents were expected and whether child sessions existed, but they do not record meaningful per-subagent actual usage.

The updated logs should support accuracy analysis for:

- predicted subagent count vs actual subagent count;
- predicted assistant/model calls vs actual calls including subagents;
- predicted tool cycles vs actual cycles including subagents;
- predicted fresh tokens vs actual fresh tokens including subagents;
- predicted cache-read-inclusive tokens vs actual cache-read-inclusive tokens including subagents;
- parent-only vs subagent-only usage breakdowns.

## Current State

Task estimation events already include limited subagent fields:

- `estimate_logged.payload.estimation_features.subagents_expected`
- `estimate_logged.payload.subagent_assumption`
- `actuals_logged.payload.subagents_used.count`
- `actuals_logged.payload.subagents_used.items[]`

Each `subagents_used.items[]` entry currently includes session metadata, but usage details are not populated. In particular, `assistant_model_calls` is hardcoded to `0`, and token/tool-cycle actuals are missing.

Start and end snapshots currently use parent-session totals only. They do not appear to include child session usage, so `task_delta` is parent-only even when the task uses subagents.

## Requirements

- Preserve existing log consumers by making changes additive.
- Keep parent-session totals available because they are useful for debugging.
- Add explicit subagent actuals rather than requiring analysis scripts to join child session logs.
- Keep each parent task log self-contained enough to analyze total task usage.
- Avoid raw message content, tool inputs, tool outputs, file contents, and prompt text.
- Support direct child subagents first; keep the schema compatible with nested subagents later.
- Use the same definition of tool cycle already used elsewhere: one assistant message with at least one tool part.

## Proposed Schema Changes

### Estimate Record

Keep existing fields and continue using `estimation_features.subagents_expected` for the predicted subagent count.

Optionally add structured subagent prediction detail later, but do not require it for the first fix:

```json
{
  "event_type": "estimate_logged",
  "payload": {
    "estimation_features": {
      "subagents_expected": 1
    },
    "subagent_assumption": "1 explore subagent expected for broad codebase inspection."
  }
}
```

This is sufficient for count-level prediction accuracy. The existing global predictions for calls, tool cycles, and tokens should continue to represent total expected task usage, including expected subagents.

### Actuals Record

Extend `actuals_logged.payload.subagents_used.items[]` with aggregate usage fields:

```json
{
  "event_type": "actuals_logged",
  "payload": {
    "subagents_used": {
      "count": 1,
      "items": [
        {
          "sessionID": "ses_child_1",
          "parentSessionID": "ses_parent",
          "title": "Explore logging implementation",
          "agent": "explore",
          "depth": 1,
          "assistant_model_calls": 6,
          "tool_cycles": 5,
          "fresh_tokens": 28000,
          "cache_read_inclusive_tokens": 260000,
          "input_tokens": 23000,
          "output_tokens": 3000,
          "reasoning_tokens": 2000,
          "cache_read_tokens": 232000,
          "cache_write_tokens": 0,
          "execution_ms": 42000
        }
      ],
      "totals": {
        "assistant_model_calls": 6,
        "tool_cycles": 5,
        "fresh_tokens": 28000,
        "cache_read_inclusive_tokens": 260000,
        "input_tokens": 23000,
        "output_tokens": 3000,
        "reasoning_tokens": 2000,
        "cache_read_tokens": 232000,
        "cache_write_tokens": 0,
        "execution_ms": 42000
      }
    }
  }
}
```

Keep the current `count` and metadata fields unchanged.

### Snapshot Records

Add child-session totals alongside existing parent-only `session_totals`:

```json
{
  "event_type": "task_end_snapshot",
  "payload": {
    "session_totals": {
      "assistant_model_calls": 12,
      "tool_cycles": 8,
      "fresh_tokens": 70000,
      "cache_read_inclusive_tokens": 900000,
      "input_tokens": 60000,
      "output_tokens": 8000,
      "reasoning_tokens": 2000,
      "cache_read_tokens": 830000,
      "execution_ms": 60000
    },
    "subagent_totals": {
      "assistant_model_calls": 6,
      "tool_cycles": 5,
      "fresh_tokens": 28000,
      "cache_read_inclusive_tokens": 260000,
      "input_tokens": 23000,
      "output_tokens": 3000,
      "reasoning_tokens": 2000,
      "cache_read_tokens": 232000,
      "cache_write_tokens": 0,
      "execution_ms": 42000
    },
    "combined_totals": {
      "assistant_model_calls": 18,
      "tool_cycles": 13,
      "fresh_tokens": 98000,
      "cache_read_inclusive_tokens": 1160000,
      "input_tokens": 83000,
      "output_tokens": 11000,
      "reasoning_tokens": 4000,
      "cache_read_tokens": 1062000,
      "cache_write_tokens": 0,
      "execution_ms": 102000
    },
    "task_delta": {
      "assistant_model_calls": 12,
      "tool_cycles": 8,
      "fresh_tokens": 70000,
      "cache_read_inclusive_tokens": 900000,
      "input_tokens": 60000,
      "output_tokens": 8000,
      "reasoning_tokens": 2000,
      "cache_read_tokens": 830000,
      "execution_ms": 60000,
      "wall_clock_ms": 120000
    },
    "subagent_delta": {
      "assistant_model_calls": 6,
      "tool_cycles": 5,
      "fresh_tokens": 28000,
      "cache_read_inclusive_tokens": 260000,
      "input_tokens": 23000,
      "output_tokens": 3000,
      "reasoning_tokens": 2000,
      "cache_read_tokens": 232000,
      "cache_write_tokens": 0,
      "execution_ms": 42000
    },
    "combined_delta": {
      "assistant_model_calls": 18,
      "tool_cycles": 13,
      "fresh_tokens": 98000,
      "cache_read_inclusive_tokens": 1160000,
      "input_tokens": 83000,
      "output_tokens": 11000,
      "reasoning_tokens": 4000,
      "cache_read_tokens": 1062000,
      "cache_write_tokens": 0,
      "execution_ms": 102000,
      "wall_clock_ms": 120000
    }
  }
}
```

Existing `session_totals` and `task_delta` remain parent-only for backward compatibility. New analysis should prefer `combined_delta` when present.

## Metric Definitions

Use one shared helper to compute totals for any session's `MessageV2.WithParts[]`:

- `assistant_model_calls`: number of `step-finish` parts, falling back to assistant message count when no step-finish parts exist.
- `tool_cycles`: count of assistant messages with at least one `tool` part.
- `fresh_tokens`: input + output + reasoning tokens from `step-finish` parts.
- `cache_read_inclusive_tokens`: fresh tokens + cache read tokens.
- `input_tokens`, `output_tokens`, `reasoning_tokens`, `cache_read_tokens`, `cache_write_tokens`: token components from `step-finish` parts.
- `execution_ms`: sum of completed tool-part durations.

The existing `sessionTotals()` helper should be extended to include `cache_write_tokens` so parent, subagent, and combined totals use the same shape.

## Implementation Plan

1. Extend the totals schema.
   Add `cache_write_tokens` to `SessionTotalsFields` and `TaskDelta` so all token components are available consistently.

2. Extract reusable totals helpers.
   Keep `sessionTotals(messages)` as the core helper and add `addTotals()`, `subtractTotals()`, and `zeroTotals()` helpers so parent/subagent/combined calculations are not duplicated.

3. Capture start snapshot with subagent state.
   When `estimate_logged` is recorded, fetch current child sessions with `sessions.children(sessionID)`, read each child's messages, compute `subagent_totals`, and store those totals in the active task state.

4. Capture end snapshot with subagent state.
   In `logActuals`, fetch child sessions and messages again, compute end subagent totals, then calculate `subagent_delta` by subtracting start subagent totals from end subagent totals.

5. Populate per-subagent actuals.
   For each child session, include metadata plus usage totals. If a child existed at start, report the child delta rather than lifetime child totals. If a child appears after the start snapshot, its start totals are zero.

6. Add combined totals and deltas.
   `combined_totals = session_totals + subagent_totals` and `combined_delta = task_delta + subagent_delta`, with `wall_clock_ms` copied from the parent task timer.

7. Keep existing fields stable.
   Do not rename `session_totals`, `task_delta`, or `subagents_used`. Add `subagent_totals`, `combined_totals`, `subagent_delta`, and `combined_delta` as optional fields.

## Active Task State

Store enough data at task start to compute subagent deltas without relying on ordering:

```ts
type ActiveTask = {
  taskID: string
  userMessageID: string
  startedAt: number
  startedMonotonic: number
  startSessionTotals?: SessionTotalsValue
  startSubagentTotals?: SessionTotalsValue
  startSubagentTotalsBySession?: Record<string, SessionTotalsValue>
  estimateLogged: boolean
}
```

`startSubagentTotalsBySession` makes per-child deltas possible even if there are multiple subagents or a child session existed before the estimated task began.

## Handling Edge Cases

- No subagents: log `count: 0`, `items: []`, and zero subagent totals.
- Child session created after start: use zero start totals for that child.
- Child session existed before start: subtract its start totals so only new usage is counted.
- Child session still running when parent ends: log whatever completed usage is available and set status normally.
- Failed or interrupted task: still log subagent deltas with available data.
- Nested subagents: first implementation may ignore grandchildren, but each item should include `depth: 1`. Future implementation can recursively collect children and set deeper depths.

## Validation

Add tests that verify:

- `estimate_logged` accepts `estimation_features.subagents_expected`.
- `actuals_logged` accepts subagent items with usage fields.
- `task_end_snapshot` accepts `subagent_delta` and `combined_delta`.
- A task with one child session logs non-zero subagent calls, tool cycles, and tokens.
- A child session that existed before the task does not have its prior usage counted in the task delta.
- Parent-only `task_delta` remains unchanged for backward compatibility.
- `combined_delta` equals `task_delta + subagent_delta` for additive fields.

Manual validation should run one estimated task that uses a subagent and confirm the JSONL file contains:

- one `estimate_logged` record with expected subagent count or assumption;
- one `task_start_snapshot` with parent, subagent, and combined totals;
- one `actuals_logged` record with populated `subagents_used.items[].assistant_model_calls`, `tool_cycles`, and tokens;
- one `task_end_snapshot` with parent, subagent, and combined deltas.

## Analysis Guidance

When analyzing newer logs:

- Use `combined_delta` for total prediction accuracy when it exists.
- Fall back to `task_delta` for older logs.
- Use `subagent_delta` to isolate subagent overhead.
- Use `subagents_used.count` vs `estimation_features.subagents_expected` for count-level prediction accuracy.
- Treat missing subagent usage fields as unknown, not zero, for logs written before this change.

## Non-Goals

- Do not log raw subagent prompts or responses.
- Do not log tool inputs or outputs.
- Do not change the user-facing estimation format in chat.
- Do not require recursive nested subagent accounting in the first implementation.
- Do not remove or reinterpret existing parent-only `task_delta` fields.
