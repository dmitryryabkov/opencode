# Prompt For Coding Agent: Improve OpenCode Estimation Logging

I am working on my OpenCode metrics/estimation project. I already added pre-execution estimation and some logging, but I need the logs to support more reliable prediction accuracy analysis and eventually a self-learning calibration loop.

Please update the logging so each estimated task produces clean, analyzable records with both cumulative session snapshots and task-level deltas.

## Goal

For every task that gets an estimate, log enough structured data to compare:

- predicted wall-clock time vs actual wall-clock time;
- predicted assistant/model calls vs actual assistant/model calls;
- predicted tool cycles vs actual tool cycles;
- predicted fresh tokens vs actual fresh tokens;
- predicted cache-read-inclusive tokens vs actual cache-read-inclusive tokens.

The current issue is that some actual counters are cumulative at the session level. That is useful, but prediction accuracy needs task-level deltas. Add explicit start/end snapshots and compute deltas so analysis does not need to reconstruct them heuristically.

## Required Behavior

When a task estimate is produced:

1. Generate or preserve a stable `task_id` for this estimated task.
2. Log the estimate record.
3. Immediately log a `task_start_snapshot` with the current cumulative session totals.
4. When the task finishes, log a `task_end_snapshot` with the new cumulative session totals.
5. Compute and log `task_delta` as:

```text
task_delta = task_end_snapshot.session_totals - task_start_snapshot.session_totals
```

6. Include wall-clock elapsed time as a task-level actual, not only a cumulative session value.

## Estimate Record Schema

Add or update the estimate log record so it includes these fields where available:

```json
{
  "event_type": "estimate_logged",
  "task_id": "stable-task-id",
  "timestamp": "ISO-8601 timestamp",
  "session_id": "current-session-id",
  "task_summary": "short user/task summary",
  "task_size_class": "tiny_focused_edit | small_implementation | moderate_implementation | complex_integration",
  "quality_bar": "minimal | prototype | production_ready | polished | exact_clone | unknown",
  "runtime_mode": "local_only | local_with_slow_command | browser_or_external | live_api | unknown",
  "prediction": {
    "wall_clock_ms": {"min": 0, "max": 0},
    "assistant_model_calls": {"min": 0, "max": 0},
    "tool_cycles": {"min": 0, "max": 0},
    "fresh_tokens": {"min": 0, "max": 0},
    "cache_read_inclusive_tokens": {"min": 0, "max": 0}
  },
  "estimation_features": {
    "current_context_tokens": 0,
    "expected_fresh_tokens_per_call": {"min": 0, "max": 0},
    "expected_effective_cache_per_call": {"min": 0, "max": 0},
    "verification_scope": "none | inspection | focused_command | typecheck | build | browser | external_flow",
    "slow_factor_count": 0,
    "main_slow_factors": [],
    "subagents_expected": 0,
    "main_uncertainty": ""
  }
}
```

Do not break existing logs if consumers already depend on them. If necessary, add these as new fields while preserving old fields.

## Snapshot Record Schema

Add a start snapshot immediately after the estimate is logged:

```json
{
  "event_type": "task_start_snapshot",
  "task_id": "stable-task-id",
  "timestamp": "ISO-8601 timestamp",
  "session_id": "current-session-id",
  "session_totals": {
    "assistant_model_calls": 0,
    "tool_cycles": 0,
    "fresh_tokens": 0,
    "cache_read_inclusive_tokens": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "reasoning_tokens": 0,
    "cache_read_tokens": 0,
    "execution_ms": 0
  }
}
```

Add an end snapshot when the estimated task finishes:

```json
{
  "event_type": "task_end_snapshot",
  "task_id": "stable-task-id",
  "timestamp": "ISO-8601 timestamp",
  "session_id": "current-session-id",
  "session_totals": {
    "assistant_model_calls": 0,
    "tool_cycles": 0,
    "fresh_tokens": 0,
    "cache_read_inclusive_tokens": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "reasoning_tokens": 0,
    "cache_read_tokens": 0,
    "execution_ms": 0
  },
  "task_delta": {
    "assistant_model_calls": 0,
    "tool_cycles": 0,
    "fresh_tokens": 0,
    "cache_read_inclusive_tokens": 0,
    "input_tokens": 0,
    "output_tokens": 0,
    "reasoning_tokens": 0,
    "cache_read_tokens": 0,
    "execution_ms": 0,
    "wall_clock_ms": 0
  }
}
```

`wall_clock_ms` should be the elapsed time from the estimate/start snapshot to task completion. If there is already a more accurate per-task timer, use that.

## Important Implementation Details

- Use monotonic timing for elapsed wall-clock when possible.
- Use ISO timestamps for log readability.
- Ensure `task_id` is present on estimate, start snapshot, end snapshot, and any actuals record.
- If multiple estimates happen in one session, each must get a distinct `task_id`.
- If a task fails or is interrupted, still log a `task_end_snapshot` with a status such as `failed`, `interrupted`, or `unknown`, plus whatever deltas are available.
- Do not rely only on ordering to pair predictions and actuals. Ordering can be used as fallback, but `task_id` should be the primary join key.
- Preserve cumulative session totals because they are useful for debugging and reconstructing older data.
- Add task deltas because they are the primary data for prediction accuracy.

## Backward Compatibility

Do not remove or rename existing log fields unless necessary. Prefer additive changes.

If there are existing `actuals_logged` records, either:

1. extend them with `task_id`, `start_session_totals`, `end_session_totals`, and `task_delta`; or
2. keep them as-is and add the new `task_start_snapshot` / `task_end_snapshot` records.

Option 2 is safer if existing UI or analysis code expects the current `actuals_logged` shape.

## Validation

After implementation, run a small local test with at least two estimated tasks in the same session.

Confirm that:

- each task has one estimate record;
- each task has one start snapshot;
- each task has one end snapshot;
- each task has a unique `task_id`;
- deltas are non-negative;
- the second task delta does not include the first task's usage;
- cumulative session totals still increase normally;
- wall-clock is task-level elapsed time;
- logs remain valid JSON/JSONL, depending on the existing format.

## Optional Helper

If useful, add a small analysis helper script or test utility that reads the log file and prints a table:

```text
task_id | class | predicted_time | actual_time | predicted_fresh | actual_fresh | predicted_cache_inclusive | actual_cache_inclusive | predicted_calls | actual_calls | predicted_tools | actual_tools
```

This helper is optional, but useful for verifying that the new log shape supports prediction accuracy analysis directly.
