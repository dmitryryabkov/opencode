# Estimation Guidance

Use these guidelines when estimating GPT-5.5 agent work across projects.

## Report Separately

- Wall-clock time.
- Assistant turns/model calls.
- Fresh tokens: input + output + reasoning.
- Cache-read-inclusive tokens when cached context is likely.
- Assumptions about subagents and verification scope.
- Main uncertainty.

## Key Learnings

- Estimate model calls, not user messages. One user prompt can produce many assistant turns.
- Current context size is not cumulative usage. Cumulative usage is summed across assistant turns/model calls.
- Cache reads can dominate reported token totals, so fresh tokens and cache-inclusive tokens need separate ranges.
- Wall-clock time should be estimated independently from token volume; high cache-read totals can still complete quickly.
- Token usage is driven by inspect/edit/verify cycles, tool output volume, and debugging loops more than final diff size.
- Subagents add independent turns, tool calls, and tokens; estimate them explicitly.
- Verification scope changes both time and tokens; state whether the estimate includes no verification, focused tests, typecheck, full test suite, build, or manual checks.

## Heuristics

- Tiny/focused edit: 3-8 assistant turns.
- Small implementation: 5-15 assistant turns.
- Moderate implementation: 15-40 assistant turns.
- Complex integration: 40+ assistant turns.
- Increase wall-clock only for concrete slow factors: full builds, full test suites, installs, live API calls, migrations, generated code, flaky failures, or repeated debug loops.
- Do not increase wall-clock just because the repository is large, cache reads are high, or a human developer would take longer.
- For cache-inclusive estimates, multiply likely cached context size by expected assistant turns, then add fresh tokens.

## Suggested Format

```text
Task class: tiny / small / moderate / complex
Wall-clock: X-Y minutes
Assistant turns/model calls: X-Y
Fresh tokens: X-Y
Cache-read-inclusive tokens: X-Y, if cached context is reused
Assumes: subagents; verification scope; slow commands
Main uncertainty: ...
```
