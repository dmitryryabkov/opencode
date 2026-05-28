# Estimation Guidance

Use these guidelines when estimating GPT-5.5 agent work before execution.

 **start from empirical baselines first, then adjust only when there is concrete evidence.**

## Primary Estimation Rule

Use this order:

1. Pick the empirical baseline row that best matches the task.
2. Apply session-depth adjustment for cache-read-inclusive tokens.
3. Apply debug-loop adjustment if browser/UI/runtime/provider behavior is likely.
4. Apply slow-command adjustment only when there is a concrete slow operation.
5. Return the estimate.

Do not estimate human developer time.

Do not make cache-read-inclusive tokens a small multiplier on fresh tokens.

## Mandatory Output

Always report:

- Task class.
- Wall-clock time.
- Assistant turns/model calls.
- Tool cycles.
- Fresh non-cache tokens: input + output + reasoning.
- Cache-read-inclusive tokens.
- Assumptions about subagents, verification, slow commands, and debug-loop risk.
- Main uncertainty.

## Empirical Baseline Table

These baselines are from logged GPT-5.5/OpenCode work. They should override intuition until more data exists.

Use the **typical range** for normal estimates. Use the **high range** when the task has uncertain inspection, browser verification, UI debugging, provider behavior, or parsing issues.

### Tiny / focused edit

Use for known-file or very local edits.

- Wall-clock: 0.5-2.5 min
- Assistant/model calls: 4-9
- Tool cycles: 3-7
- Fresh tokens: 20k-50k
- Cache-read-inclusive tokens: 400k-900k

### Small implementation

Use for local implementation work, small UI/backend fixes, prompt/config changes, or focused behavior changes.

- Wall-clock: 1-3 min
- Assistant/model calls: 5-10
- Tool cycles: 4-9
- Fresh tokens: 30k-75k
- Cache-read-inclusive tokens: 500k-2.0M

### Moderate implementation

Use for several files, frontend/backend interaction, some exploration, or likely focused verification.

- Wall-clock: 1.5-5 min
- Assistant/model calls: 8-16
- Tool cycles: 6-14
- Fresh tokens: 25k-90k
- Cache-read-inclusive tokens: 600k-2.0M

### Complex integration

Use for multi-part implementation, broad repo changes, substantial UI + backend behavior, new workflows, or repeated verification.

- Wall-clock: 5-15 min
- Assistant/model calls: 18-45
- Tool cycles: 15-40
- Fresh tokens: 70k-130k
- Cache-read-inclusive tokens: 2.5M-5.0M

## Hard Floors

Do not go below these floors for any real code task unless it is a pure answer-only task with no file inspection.

- Fresh tokens: 20k minimum.
- Cache-read-inclusive tokens: 300k minimum.
- Assistant/model calls: 4 minimum.
- Tool cycles: 3 minimum.

For any task that includes file inspection plus edit plus verification, use at least:

- Fresh tokens: 30k.
- Cache-read-inclusive tokens: 500k.
- Assistant/model calls: 5.
- Tool cycles: 4.

## Wall-Clock Guardrails

Wall-clock must be estimated separately from tokens.

Use low wall-clock by default for GPT-5.5 on small repos. Most small/moderate tasks should be under 5 minutes unless there is a concrete slow factor.

Do not estimate above 10 minutes unless at least one of these is true:
- full build;
- slow test suite;
- dependency install;
- live API wait;
- migration or generated code;
- large unknown repo exploration;
- repeated failed verification loops are likely.

Do not estimate above 20 minutes unless the task is truly broad or depends on slow external operations.

If no slow command is expected:
- tiny: cap high end at 3 minutes;
- small: cap high end at 4 minutes;
- moderate: cap high end at 6 minutes;
- complex: cap high end at 15 minutes.

## Token Estimation Guardrails

Token estimates must be anchored high enough to match agentic coding behavior.

Fresh tokens are not just final output. They include:
- code inspection;
- tool results;
- reasoning;
- patches;
- verification;
- debugging;
- final explanation.

For fresh tokens, start with:

```text
fresh tokens ~= assistant/model calls * fresh tokens per call
```

Use these rough per-call values:

- tiny/focused: 4k-7k fresh tokens per call;
- small: 5k-8k fresh tokens per call;
- moderate: 4k-8k fresh tokens per call;
- complex: 3k-6k fresh tokens per call, but many more calls.

Then enforce the hard floors and empirical baseline table.

## Cache-Read-Inclusive Token Estimation

Cache-read-inclusive tokens are the most important correction.

Do not estimate cache-read-inclusive tokens from task size alone. Estimate from:

```text
cache-read-inclusive tokens ~= fresh tokens + (effective cached context per call * assistant/model calls)
```

If current effective cached context per call is visible, use it.

If it is not visible, use the session-depth fallback:

### Early session

Use when the task is near the beginning of a session and little repo/context has accumulated.

- Tiny: 300k-700k
- Small: 400k-1.0M
- Moderate: 500k-1.2M
- Complex: 1.5M-3.0M

### Mid session

Use after several tasks or after repeated file inspection.

- Tiny: 500k-1.0M
- Small: 800k-1.8M
- Moderate: 800k-2.0M
- Complex: 2.5M-5.0M

### Late session / large context

Use when the session already contains many assistant messages, repeated repo inspection, or a large context panel.

- Tiny: 700k-1.5M
- Small: 1.0M-2.5M
- Moderate: 1.2M-3.0M
- Complex: 3.0M-6.0M+

If unsure, choose mid session. Do not choose early session just because the task itself is small.

## Debug-Loop Adjustment

Add a debug-loop adjustment when the task involves:

- browser or Playwright verification;
- Next.js dev server behavior;
- stale build/cache/chunk errors;
- hydration or CSS rendering problems;
- live provider output;
- LLM parsing or extraction;
- UI state not updating;
- vague behavior change that requires repo search.

Debug-loop adjustment:

- Add 2-6 assistant/model calls.
- Add 2-6 tool cycles.
- Add 15k-50k fresh tokens.
- Add 300k-1.5M cache-read-inclusive tokens.
- Add wall-clock time only if slow commands or repeated manual checks are expected.

## Bias Correction Pass

Before returning the estimate, perform this explicit correction:

1. If wall-clock seems based on human implementation effort, divide it by 3-5.
2. If fresh tokens are below 20k for a code task, raise them.
3. If cache-read-inclusive tokens are below 300k for a code task, raise them.
4. If cache-read-inclusive tokens are less than 10x fresh tokens in an active coding session, re-check the estimate.
5. If tool cycles are plausible but tokens are tiny, trust the tool cycles and raise tokens.
6. If the estimate says “small implementation” but includes file inspection + edit + verification, do not report fresh tokens below 30k or cache-inclusive below 500k.

## Anti-Patterns

Avoid these patterns:

- Estimating cache-read-inclusive tokens as 2k-20k for a coding task.
- Estimating fresh tokens as 2k-8k for a task that reads and edits code.
- Giving a 10-25 minute estimate for a small task without slow commands.
- Using task class alone to estimate cache-inclusive tokens.
- Treating prompt/config edits as token-cheap if they require repo search.
- Treating a short wall-clock task as token-cheap.

## Suggested Format

```text
Task class: tiny / small / moderate / complex

Calibration baseline used: tiny / small / moderate / complex, early/mid/late session

Wall-clock: X-Y minutes
Assistant turns/model calls: X-Y
Tool cycles: X-Y
Fresh tokens: X-Y
Cache-read-inclusive tokens: X-Y

Assumes:
- subagents: none / N
- verification: none / focused test / typecheck / full test suite / build / manual check
- slow commands: none / list
- debug-loop risk: low / medium / high
- session depth: early / mid / late / unknown

Main uncertainty:
The biggest unknown that could materially change this estimate.
```

## Final Sanity Check

Ask:

- Did I start from the empirical baseline table?
- Did I avoid human-time estimation?
- Did I cap wall-clock unless slow operations justify more?
- Did I apply hard floors?
- Did I estimate cache-inclusive tokens from session depth or cached context per call?
- Are cache-inclusive tokens at least 10x fresh tokens for an active coding session?
- Did I add debug-loop adjustment when browser/UI/runtime/provider behavior is involved?
