# Automatic Estimation Pre-Execution Design

## Goal

Add an automatic pre-execution estimate behavior that follows OpenCode's existing tool/subagent decision pattern. The primary assistant decides whether a task needs an estimate during its normal first model pass, logs the estimate before any execution tool use, and OpenCode logs actual usage after execution completes.

This is the next step of the existing Advanced Metrics feature. The estimate is intended for local analysis and future calibration. It should separate wall-clock time, model calls, tool cycles, fresh token usage, and cache-read-inclusive token usage using `estimation-guidance.md`.

## Requirements

- Classify every new user task before execution as estimate-needed or estimate-skipped using the same assistant-driven decision style used for tools and subagents.
- Require estimates for moderate or complex tasks.
- Require estimates for likely multi-file changes.
- Require estimates for tasks involving verification commands.
- Require estimates for backend plus frontend, API, config, schema, or prompt changes.
- Require estimates for likely subagent use.
- Require estimates for live API calls, builds, tests, migrations, or dependency installs.
- Require estimates when expected wall-clock time is over 5 minutes.
- Require estimates when expected assistant/model calls are over 10.
- Require estimates when the user explicitly asks for an estimate.
- Skip estimates for tiny, focused edits with known files and minimal or no verification.
- When an estimate is needed, produce and log a structured estimate before execution starts and before other execution tools are used.
- After execution, log actuals using the same `task_id`.
- Keep the schema extensible for future `estimate_exceeded`, `estimate_revised`, `user_budget_confirmation_requested`, and `guideline_update_suggestion` events.
- Do not implement analytics, alerts, estimate correction, or self-updating guidelines in the first version.
- Expose the behavior through the existing `Advanced metrics` settings group with a `Use estimates` toggle below `Log usage metrics`.
- Append estimation events to the same per-session JSONL files used by Advanced Metrics usage logging.
- Show the estimate result in chat when an estimate is needed.
- Continue automatically after showing the estimate; do not wait for user confirmation in the first version.

## Non-Goals

- No automatic estimate correction.
- No analytics UI.
- No alerts when estimates are exceeded.
- No budget approval flow.
- No automatic update to `estimation-guidance.md`.
- No attempt to estimate human developer time.

## Proposed Storage

Write estimation events as append-only JSON Lines to the same per-session files used by Advanced Metrics usage logging:

```text
~/.local/share/opencode/metrics/sessions/<sessionID>.jsonl
```

If `XDG_DATA_HOME` is set, use:

```text
$XDG_DATA_HOME/opencode/metrics/sessions/<sessionID>.jsonl
```

Each line is one complete event. Context metrics snapshots and estimation events intentionally share this file because they are one Advanced Metrics timeline. The event payload includes `task_id`, so multiple tasks in the same session can be analyzed independently.

## Settings

Advanced Metrics owns both usage snapshots and estimates.

UI group:

```text
Advanced metrics
```

Rows:

- `Log usage metrics`: controls JSONL emission for Advanced Metrics events, including context metrics snapshots and estimation events.
- `Use estimates`: controls whether OpenCode exposes the estimate instructions/tooling that make the assistant perform the pre-execution estimate decision and estimate logging flow.

The `Use estimates` row should appear directly below `Log usage metrics`.

`Use estimates` should default to on.

If `Use estimates` is disabled, skip the pre-execution estimation flow. If `Log usage metrics` is disabled but `Use estimates` is enabled, still show estimates in chat but do not append estimate or actuals events to JSONL.

## User Experience

When an estimate is needed, the user should see that estimation was performed and should see the estimate results in chat before execution starts.

Use the format from `estimation-guidance.md`:

```text
Task class: tiny / small / moderate / complex

Wall-clock: X-Y minutes
Assistant turns/model calls: X-Y
Tool cycles: X-Y
Fresh tokens: X-Y
Cache-read-inclusive tokens: X-Y, if cached context is reused

Assumes:
- subagents: none / N
- verification: none / focused test / typecheck / full test suite / build / manual check
- slow commands: none / list

Main uncertainty:
The biggest unknown that could materially change this estimate.
```

The estimate is informational in the first version. After showing the estimate, the assistant continues automatically without asking for confirmation. A later version may add a setting or UI flow that pauses for confirmation.

When an estimate is skipped, do not mention the skip in chat. The assistant should silently proceed.

## Task Boundary

A task is one user request that causes assistant work. Generate a new `task_id` when a new user request starts execution.

Use a stable, locally unique ID format:

```text
task_<timestamp>_<short-random-suffix>
```

Example:

```text
task_20260518T142233Z_a8f3c1
```

The same `task_id` must be used for:

- The pre-execution classification event.
- The pre-execution estimate event, when one is needed.
- The post-execution actuals event.
- Future related events such as estimate revisions or budget confirmations.

## Decision Model

Follow the same general pattern OpenCode uses for subagents:

- OpenCode exposes capability descriptions and rules to the primary assistant.
- The primary assistant decides whether the current task needs that capability.
- OpenCode validates and executes the requested tool/action.
- The system captures durable metrics around the assistant's decision and resulting execution.

There should not be a separate hidden model call whose only job is to classify the task. The estimate decision should happen in the normal first assistant/model call, alongside the model's existing decision about whether to use tools or subagents.

OpenCode should provide:

- System/developer prompt instructions describing when estimates are required and when they can be skipped.
- A structured estimate logging capability, preferably a tool or equivalent internal action, that appends an `opencode.task_estimation.v1` event to the Advanced Metrics JSONL file when `Log usage metrics` is enabled.
- Runtime validation that estimate log events match the schema.
- Post-execution actuals logging from system/session metrics.

The assistant should provide:

- The estimate-needed decision.
- `trigger_reasons`.
- The structured estimate payload when an estimate is needed.
- A skipped classification event when an estimate is not needed, if `Log usage metrics` is enabled.
- A user-facing estimate in chat when an estimate is needed.

## Pre-Execution Flow

Before code-editing tools, shell commands, subagent calls, live API calls, builds, tests, installs, migrations, or other execution actions for a user task:

1. Create a `task_id`.
2. Start the normal primary assistant/model pass with estimation instructions available when `Use estimates` is enabled.
3. The assistant decides whether an estimate is needed using the required triggers and skip rules.
4. If `Log usage metrics` is enabled, the assistant logs `estimate_classified` through the structured logging capability.
5. If an estimate is needed, the assistant produces a structured estimate using `estimation-guidance.md` and shows it in chat before any other execution tool use.
6. If an estimate is needed and `Log usage metrics` is enabled, the assistant logs `estimate_logged` before any other execution tool use.
7. The assistant proceeds with normal execution, including tools or subagents as needed, without waiting for user confirmation.
8. When the task completes, OpenCode logs `actuals_logged` from session/runtime metrics if `Log usage metrics` is enabled.

The estimate decision should use the prompt, known session context, and any context already available to the assistant before execution. It should not perform repository exploration merely to decide whether an estimate is needed. If the decision depends on repository inspection, bias toward requiring an estimate.

## Prompt and Tool Integration

The first version should align with the current Task/subagent pattern rather than adding a separate classifier service.

Implementation shape:

- Add estimate rules to the primary assistant instructions when `Use estimates` is enabled.
- Add or reuse a metrics logging tool/action that accepts `opencode.task_estimation.v1` events.
- Put the estimate logging tool before execution tools in the expected workflow, but do not make it a subagent.
- Keep actuals logging outside the assistant, because actuals are measured after execution from session/runtime metrics.

This keeps the estimate decision in the same model pass that already decides whether to call tools or launch subagents. The overhead for skipped tasks is primarily prompt/context overhead plus one small logging action if skipped classifications are logged. There is no additional classifier model call.

If `Log usage metrics` is disabled, the estimate logging tool/action should not append events, but the assistant should still produce the user-facing estimate when `Use estimates` is enabled.

## Estimate-Needed Triggers

An estimate is required when any of these are true:

- The task is likely `moderate` or `complex`.
- The task likely touches multiple files.
- The task involves verification commands.
- The task combines backend and frontend work.
- The task involves API, config, schema, or prompt changes.
- The task likely requires a subagent.
- The task likely requires live API calls.
- The task likely requires a build.
- The task likely requires tests.
- The task likely requires migrations.
- The task likely requires dependency installs.
- Expected wall-clock time is over 5 minutes.
- Expected assistant/model calls are over 10.
- The user explicitly asks for an estimate.

Use `trigger_reasons` to record the exact reasons that made `estimate_needed` true.

## Estimate-Skipped Cases

Skip the structured estimate only when the task is tiny and focused:

- Known file or known small area.
- Minimal ambiguity.
- Single-file or very small localized change.
- No expected subagent use.
- No expected build, test suite, migration, install, or live API call.
- No meaningful verification beyond inspection or a very quick focused command.
- Expected wall-clock time is 5 minutes or less.
- Expected assistant/model calls are 10 or fewer.
- The user did not explicitly ask for an estimate.

When `Log usage metrics` is enabled, still log the classification event for skipped estimates so later analysis can compare skipped tasks with actual outcomes. Do not show skipped-estimate classifications in chat.

## Task Classes

Use the classes from `estimation-guidance.md`:

- `tiny_focused_edit`
- `small_implementation`
- `moderate_implementation`
- `complex_integration`

The estimate should use the guidance as the source of truth for ranges and assumptions. The implementation can normalize display labels, but logged values should use stable enum-like names.

## Log Event Types

Use event-specific schema names in the same JSONL file. Existing context snapshots continue to use:

```text
opencode.context_metrics.v1
```

Estimation events use:

```text
opencode.task_estimation.v1
```

Initial event types:

- `estimate_classified`
- `estimate_logged`
- `actuals_logged`

Reserved future event types:

- `estimate_exceeded`
- `estimate_revised`
- `user_budget_confirmation_requested`
- `guideline_update_suggestion`

The writer should accept only known first-version event types initially, but the shared event envelope should leave space for the reserved future types without changing file layout.

## Shared Event Envelope

Every event should include:

```json
{
  "schema": "opencode.task_estimation.v1",
  "event_type": "estimate_logged",
  "task_id": "task_20260518T142233Z_a8f3c1",
  "time": {
    "created": "2026-05-18T14:22:33.000Z",
    "epochMs": 1779114153000
  },
  "project": {
    "id": "proj_...",
    "directory": "/Users/alexandra/opencode",
    "workspaceID": "wrk_..."
  },
  "session": {
    "id": "ses_...",
    "title": "Example task"
  },
  "request": {
    "user_message_id": "msg_...",
    "assistant_message_start_id": null
  },
  "payload": {}
}
```

Do not include raw prompt text, tool inputs, tool outputs, file contents, or message parts. Message IDs and aggregate metadata are enough to correlate with session state.

## Classification Event Shape

Log one `estimate_classified` event before execution starts, even when no estimate is needed, if `Log usage metrics` is enabled.

```json
{
  "schema": "opencode.task_estimation.v1",
  "event_type": "estimate_classified",
  "task_id": "task_20260518T142233Z_a8f3c1",
  "time": {
    "created": "2026-05-18T14:22:33.000Z",
    "epochMs": 1779114153000
  },
  "project": {
    "id": "proj_...",
    "directory": "/Users/alexandra/opencode",
    "workspaceID": "wrk_..."
  },
  "session": {
    "id": "ses_...",
    "title": "Example task"
  },
  "request": {
    "user_message_id": "msg_...",
    "assistant_message_start_id": null
  },
  "payload": {
    "estimate_needed": true,
    "trigger_reasons": [
      "likely_multi_file_change",
      "expected_verification_commands",
      "expected_wall_clock_over_5_minutes"
    ],
    "task_class": "moderate_implementation",
    "classification_confidence": "medium"
  }
}
```

`classification_confidence` is informational and should be one of `low`, `medium`, or `high`.

## Estimate Event Shape

When `estimate_needed` is true and `Log usage metrics` is enabled, log one `estimate_logged` event before execution starts.

Also show the estimate in chat using the suggested format from `estimation-guidance.md`.

The logged estimate must include:

- `task_id`
- timestamp
- `estimate_version`
- `estimate_needed`
- `trigger_reasons`
- `task_class`
- wall-clock range
- assistant/model call range
- tool cycle range
- fresh token range
- cache-read-inclusive token range
- assumptions
- subagent assumption
- verification assumption
- slow command assumption
- main uncertainty

Example:

```json
{
  "schema": "opencode.task_estimation.v1",
  "event_type": "estimate_logged",
  "task_id": "task_20260518T142233Z_a8f3c1",
  "time": {
    "created": "2026-05-18T14:22:35.000Z",
    "epochMs": 1779114155000
  },
  "project": {
    "id": "proj_...",
    "directory": "/Users/alexandra/opencode",
    "workspaceID": "wrk_..."
  },
  "session": {
    "id": "ses_...",
    "title": "Example task"
  },
  "request": {
    "user_message_id": "msg_...",
    "assistant_message_start_id": null
  },
  "payload": {
    "estimate_version": "2026-05-18.1",
    "estimate_needed": true,
    "trigger_reasons": [
      "likely_multi_file_change",
      "expected_verification_commands",
      "expected_wall_clock_over_5_minutes"
    ],
    "task_class": "moderate_implementation",
    "ranges": {
      "wall_clock_minutes": {
        "min": 8,
        "max": 18
      },
      "assistant_model_calls": {
        "min": 15,
        "max": 30
      },
      "tool_cycles": {
        "min": 8,
        "max": 18
      },
      "fresh_tokens": {
        "min": 45000,
        "max": 120000
      },
      "cache_read_inclusive_tokens": {
        "min": 400000,
        "max": 1200000
      }
    },
    "assumptions": [
      "Implementation path is discoverable from existing project structure.",
      "No dependency install or migration is required."
    ],
    "subagent_assumption": "No subagents expected.",
    "verification_assumption": "Focused test or typecheck expected; no full build expected.",
    "slow_command_assumption": "No slow command expected beyond focused verification.",
    "main_uncertainty": "The affected files may be broader than the initial request suggests."
  }
}
```

Use integer range values. Token fields represent total task usage estimates, not per-call estimates.

## Actuals Event Shape

After execution completes, log one `actuals_logged` event with the same `task_id` when `Log usage metrics` is enabled.

The logged actuals must include:

- `task_id`
- wall-clock time
- assistant/model calls
- tool cycles
- fresh tokens
- cache-read-inclusive tokens
- subagents used
- verification performed
- slow commands observed

Example:

```json
{
  "schema": "opencode.task_estimation.v1",
  "event_type": "actuals_logged",
  "task_id": "task_20260518T142233Z_a8f3c1",
  "time": {
    "created": "2026-05-18T14:38:10.000Z",
    "epochMs": 1779115090000
  },
  "project": {
    "id": "proj_...",
    "directory": "/Users/alexandra/opencode",
    "workspaceID": "wrk_..."
  },
  "session": {
    "id": "ses_...",
    "title": "Example task"
  },
  "request": {
    "user_message_id": "msg_...",
    "assistant_message_start_id": "msg_..."
  },
  "payload": {
    "wall_clock_ms": 935000,
    "assistant_model_calls": 22,
    "tool_cycles": 13,
    "tokens": {
      "fresh": 78000,
      "cache_read_inclusive": 840000,
      "input": 42000,
      "output": 18000,
      "reasoning": 18000,
      "cache_read": 762000,
      "cache_write": 15000
    },
    "subagents_used": {
      "count": 0,
      "items": []
    },
    "verification_performed": [
      {
        "kind": "typecheck",
        "command": "bun run typecheck",
        "status": "passed",
        "duration_ms": 42000
      }
    ],
    "slow_commands_observed": []
  }
}
```

`fresh` should include input, output, reasoning, and other non-cache token categories available from the model/provider metrics. `cache_read_inclusive` should include `fresh` plus cache-read tokens.

## Tool Cycle Counting

Count one tool cycle for each assistant step that invokes one or more tools before returning control to the model. Parallel tool calls in the same assistant step count as one tool cycle.

This keeps tool cycle counts aligned with inspect/edit/verify loops rather than raw tool call count.

## Assistant/Model Call Counting

Count one assistant/model call each time the model is invoked to produce assistant work for the task. Include subagent model calls in actuals only if they are also represented in `subagents_used.items`, so parent-only and inclusive totals can be distinguished later.

First version recommendation:

- `assistant_model_calls` is inclusive of parent and subagent calls.
- `subagents_used.items[].assistant_model_calls` records each subagent contribution.
- Future analysis can compute parent-only calls by subtracting subagent item totals.

## Token Counting

Use provider/session metrics where available. Store both aggregate and component fields when possible.

Definitions:

- `fresh`: input plus output plus reasoning plus other non-cache tokens.
- `cache_read_inclusive`: `fresh` plus cache-read tokens.
- `cache_write`: stored separately and not included in `fresh` unless provider accounting already includes it in input tokens.

If a token component is unavailable, omit that component and include the best available aggregate. Do not invent exact component values.

## Verification and Slow Commands

`verification_performed` records commands or checks intentionally used to validate the task.

Use `kind` values such as:

- `inspection`
- `unit_test`
- `integration_test`
- `typecheck`
- `lint`
- `build`
- `manual_check`
- `migration_check`

`slow_commands_observed` records commands that materially affected wall-clock time. Include installs, builds, full test suites, migrations, live API calls, slow typechecks, or any command over a configurable threshold.

Initial threshold:

```text
30 seconds
```

## Capture Points

Classification and estimate display/logging should happen during the normal first primary assistant/model pass, before the first execution action for the task.

Actuals logging should happen when the assistant finishes the task, including after tool execution and final response generation, when `Log usage metrics` is enabled. If the task is interrupted or errors, still log actuals with available data and add:

```json
{
  "completion_status": "interrupted"
}
```

Valid `completion_status` values:

- `completed`
- `interrupted`
- `failed`

Default to `completed` when omitted in first-version successful events.

## Estimate Versioning

Use `estimate_version` to identify the version of the estimation prompt, rules, or implementation that produced the estimate.

Recommended format:

```text
YYYY-MM-DD.N
```

Example:

```text
2026-05-18.1
```

Increment the suffix when the estimation behavior changes on the same date.

## Privacy

Do not log raw user prompts, assistant responses, tool inputs, tool outputs, file contents, diffs, stack traces, or message parts.

Allowed fields:

- IDs.
- Timestamps.
- Project and session metadata.
- Classification decisions.
- Estimate ranges and assumptions.
- Aggregate usage metrics.
- Command names used for verification or slow-command accounting.

Command names can reveal project scripts. This is acceptable for the first version because logs are local metrics data, but command stdout/stderr should not be logged.

## Failure Handling

Estimate logging should not block task execution if the metrics writer fails. If writing fails, report the failure through existing debug logging and continue execution.

Actuals logging should also be best-effort. A failed actuals write should not change the assistant response.

If the assistant is uncertain, instructions should require `estimate_needed: true`. If estimate logging fails, continue execution and report the logging failure through existing debug logging.

## Extensibility

Keep future event types in the same schema and file layout.

Reserved future payload directions:

- `estimate_exceeded`: records that actuals crossed an estimated max range.
- `estimate_revised`: records a new estimate after scope changes or discovered uncertainty.
- `user_budget_confirmation_requested`: records that execution paused to ask the user for budget confirmation.
- `guideline_update_suggestion`: records a suggested change to estimation guidance based on observed drift.

Do not emit these events in the first version.

## Implementation Notes

- Add estimate decision rules to the primary assistant prompt/tool instructions when `Use estimates` is enabled.
- Do not add a separate classifier model call in the first version.
- Use `estimation-guidance.md` as the source material for the estimate instructions and structured estimate generation.
- Keep the log writer shared with existing metrics infrastructure.
- Extend the existing session metrics write path so `/session/:sessionID/metrics` can append both `opencode.context_metrics.v1` snapshots and `opencode.task_estimation.v1` events to `metrics/sessions/<sessionID>.jsonl`.
- Reuse the global data directory behavior already used for metrics logs.
- Add tests around prompt/tool availability gating, event shape validation, and actuals aggregation if the surrounding codebase has suitable test seams.

## Open Questions

- Should skipped tiny tasks log only `estimate_classified`, or also a compact skipped estimate event?
  - Decision: Log only `estimate_classified` for skipped tasks in the first version.
- Should `assistant_model_calls` in actuals include subagent calls?
  - Decision: Yes, make it inclusive and record subagent contributions separately.
- Should command arguments be logged for verification commands?
  - Decision: Log the command string as executed, but not stdout, stderr, or tool output.
- Should actuals be logged for failed or interrupted tasks?
  - Decision: Yes, with available data and `completion_status`.
- Should estimate-needed classification use a separate model call?
  - Decision: No for the first version. Follow the existing tool/subagent pattern and have the primary assistant decide during its normal first model pass.
- Should estimates be visible to users or only logged?
  - Decision: Show estimates to users in chat when an estimate is needed.
- Should the assistant wait for confirmation after showing an estimate?
  - Decision: No for the first version. Continue automatically. A later version may add UI settings for confirmation.
- Should `Use estimates` default to on?
  - Decision: Yes.
- Should estimates still be shown when `Log usage metrics` is off?
  - Decision: Yes. Do not log JSONL events, but still estimate and show the result in chat when `Use estimates` is on.
- Should skipped estimates be visible to users?
  - Decision: No. Skip silently.
- What format should user-facing estimates use?
  - Decision: Use the suggested format from `estimation-guidance.md`.
