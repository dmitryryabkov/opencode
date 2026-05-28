# Cnfigurable Estimated Cost support via the OpenCode config schema.

## Goal

Add a new UI metric in the Context panel called **Estimated Cost**. It should be separate from the existing **Total Cost** metric and must not change existing cost/billing behavior.

## Context

I am using ChatGPT subscription usage, not a metered API key, but I want the UI to show what the task would approximately cost under GPT-5.5 API-equivalent pricing.

## Requirements

### 1. Config schema

Extend the OpenCode config schema with a new optional config section for estimated cost.

Use a clear fork-specific config path, for example:

```json
{
  "experimental": {
    "estimatedCost": {
      "enabled": true,
      "label": "Estimated Cost",
      "pricing": {
        "input": 0.000005,
        "output": 0.00003,
        "cache_read": 0.0000005,
        "cache_write": 0
      }
    }
  }
}
```

If `experimental` is not the right place based on the existing schema structure, choose the closest appropriate location, but keep the new setting clearly separate from existing provider/model cost fields.

The pricing values are per-token USD values:

- `input`: $5.00 / 1M tokens = `0.000005`
- `output`: $30.00 / 1M tokens = `0.00003`
- `cache_read`: $0.50 / 1M tokens = `0.0000005`
- `cache_write`: optional, default `0` unless the existing token accounting has a cache-write metric

Make all `estimatedCost` fields optional except where needed when `enabled` is `true`.

### 2. Config loading / types

Update config TypeScript types, defaults, validation, and schema generation if applicable.

Defaults:

- `estimatedCost.enabled`: `false`
- `estimatedCost.label`: `"Estimated Cost"`
- pricing defaults may be omitted, but if pricing is provided, use the provided values
- if `enabled` is `true` but pricing is missing or incomplete, fail gracefully: do not crash the UI. Either hide Estimated Cost or show a neutral placeholder.

### 3. Cost calculation

Add a helper that computes estimated cost from currently available token usage.

Use this formula:

```text
estimatedCost =
  uncachedInputTokens * pricing.input
+ outputTokens * pricing.output
+ cacheReadTokens * pricing.cache_read
+ cacheWriteTokens * pricing.cache_write
```

Important:

If the available input token metric already includes cached input tokens, avoid double-counting. Compute:

```text
uncachedInputTokens = max(totalInputTokens - cacheReadTokens - cacheWriteTokens, 0)
```

If the existing OpenCode token accounting already separates uncached input from cached input, use the separated value directly.

Do not modify the existing Total Cost calculation.

### 4. Context panel UI

Find where the Context panel renders **Total Cost**.

Add a second metric named from `config.experimental.estimatedCost.label`, defaulting to **Estimated Cost**.

Render it only when `estimatedCost.enabled` is `true` and enough token usage data exists.

Display format:

- USD
- use 2 decimal places for values >= $0.01
- use 4 decimal places for values below $0.01
- use `$0.00` or `$0.0000` consistently for near-zero values

### 5. Scope constraints

Do not add analytics, alerts, logging, estimate-vs-actual comparisons, budget enforcement, or self-learning behavior.

Do not rename or remove Total Cost.

Do not change provider/model built-in pricing behavior.

Do not change task execution behavior.

This is config + calculation + UI only.

### 6. Tests / verification

Add or update focused tests if this codebase has nearby tests for config parsing, cost calculation, or Context panel rendering.

At minimum verify manually:

- With `estimatedCost.enabled` omitted or `false`, UI behaves exactly as before.
- With `estimatedCost.enabled` true and GPT-5.5 pricing configured, Context panel shows both Total Cost and Estimated Cost.
- Existing Total Cost is unchanged.
- Cached tokens are not double-counted as full input tokens.
- Missing pricing does not crash the app.

Please inspect the existing config schema and UI structure before implementing, then make the minimal clean change that fits the current architecture.
