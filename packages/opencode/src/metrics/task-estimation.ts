import { Effect, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { Session } from "@/session/session"
import { MessageV2 } from "@/session/message-v2"
import type { SessionID } from "@/session/schema"
import fs from "node:fs/promises"
import path from "node:path"
import { performance } from "node:perf_hooks"
import { randomUUID } from "node:crypto"

const EventTypes = [
  "estimate_classified",
  "estimate_logged",
  "actuals_logged",
  "task_start_snapshot",
  "task_end_snapshot",
] as const
const TaskClasses = [
  "tiny_focused_edit",
  "small_implementation",
  "moderate_implementation",
  "complex_integration",
] as const
const QualityBars = ["minimal", "prototype", "production_ready", "polished", "exact_clone", "unknown"] as const
const RuntimeModes = ["local_only", "local_with_slow_command", "browser_or_external", "live_api", "unknown"] as const
const VerificationScopes = [
  "none",
  "inspection",
  "focused_command",
  "typecheck",
  "build",
  "browser",
  "external_flow",
] as const

const Time = Schema.Struct({
  created: Schema.String,
  epochMs: Schema.Number,
})

const Project = Schema.Struct({
  id: Schema.String,
  directory: Schema.String,
  workspaceID: Schema.optional(Schema.String),
})

const EventSession = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
})

const Request = Schema.Struct({
  user_message_id: Schema.String,
  assistant_message_start_id: Schema.NullOr(Schema.String),
})

const Range = Schema.Struct({
  min: Schema.Int,
  max: Schema.Int,
})

const Prediction = Schema.Struct({
  wall_clock_ms: Range,
  assistant_model_calls: Range,
  tool_cycles: Range,
  fresh_tokens: Range,
  cache_read_inclusive_tokens: Range,
})

const EstimationFeatures = Schema.Struct({
  current_context_tokens: Schema.optional(Schema.Int),
  expected_fresh_tokens_per_call: Schema.optional(Range),
  expected_effective_cache_per_call: Schema.optional(Range),
  verification_scope: Schema.optional(Schema.Literals(VerificationScopes)),
  slow_factor_count: Schema.optional(Schema.Int),
  main_slow_factors: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  subagents_expected: Schema.optional(Schema.Int),
  main_uncertainty: Schema.optional(Schema.String),
})

const SessionTotalsFields = {
  assistant_model_calls: Schema.Int,
  tool_cycles: Schema.Int,
  fresh_tokens: Schema.Int,
  cache_read_inclusive_tokens: Schema.Int,
  input_tokens: Schema.Int,
  output_tokens: Schema.Int,
  reasoning_tokens: Schema.Int,
  cache_read_tokens: Schema.Int,
  cache_write_tokens: Schema.optional(Schema.Int),
  execution_ms: Schema.Int,
}

const SessionTotals = Schema.Struct(SessionTotalsFields)

const TaskDelta = Schema.Struct({
  ...SessionTotalsFields,
  wall_clock_ms: Schema.Int,
})

const TaskStatus = Schema.Literals(["completed", "interrupted", "failed", "cancelled", "unknown"])

const EstimatePayload = Schema.Struct({
  estimate_version: Schema.optional(Schema.String),
  estimate_needed: Schema.Boolean,
  trigger_reasons: Schema.mutable(Schema.Array(Schema.String)),
  task_class: Schema.Literals(TaskClasses),
  task_summary: Schema.optional(Schema.String),
  task_size_class: Schema.optional(Schema.Literals(TaskClasses)),
  quality_bar: Schema.optional(Schema.Literals(QualityBars)),
  runtime_mode: Schema.optional(Schema.Literals(RuntimeModes)),
  classification_confidence: Schema.optional(Schema.Literals(["low", "medium", "high"])),
  prediction: Schema.optional(Prediction),
  ranges: Schema.optional(
    Schema.Struct({
      wall_clock_minutes: Range,
      assistant_model_calls: Range,
      tool_cycles: Range,
      fresh_tokens: Range,
      cache_read_inclusive_tokens: Range,
    }),
  ),
  assumptions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  subagent_assumption: Schema.optional(Schema.String),
  verification_assumption: Schema.optional(Schema.String),
  slow_command_assumption: Schema.optional(Schema.String),
  main_uncertainty: Schema.optional(Schema.String),
  estimation_features: Schema.optional(EstimationFeatures),
})

const ActualsPayload = Schema.Struct({
  wall_clock_ms: Schema.Int,
  assistant_model_calls: Schema.Int,
  tool_cycles: Schema.Int,
  tokens: Schema.Struct({
    fresh: Schema.Int,
    cache_read_inclusive: Schema.Int,
    input: Schema.optional(Schema.Int),
    output: Schema.optional(Schema.Int),
    reasoning: Schema.optional(Schema.Int),
    cache_read: Schema.optional(Schema.Int),
    cache_write: Schema.optional(Schema.Int),
  }),
  subagents_used: Schema.Struct({
    count: Schema.Int,
    items: Schema.mutable(Schema.Array(Schema.Record(Schema.String, Schema.Any))),
    totals: Schema.optional(SessionTotals),
  }),
  verification_performed: Schema.mutable(Schema.Array(Schema.Record(Schema.String, Schema.Any))),
  slow_commands_observed: Schema.mutable(Schema.Array(Schema.Record(Schema.String, Schema.Any))),
  completion_status: Schema.optional(TaskStatus),
})

const TaskStartSnapshotPayload = Schema.Struct({
  task_id: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  estimate_needed: Schema.optional(Schema.Boolean),
  task_class: Schema.optional(Schema.Literals(TaskClasses)),
  task_summary: Schema.optional(Schema.String),
  start_timestamp: Schema.optional(Schema.String),
  session_totals: SessionTotals,
  subagent_totals: Schema.optional(SessionTotals),
  combined_totals: Schema.optional(SessionTotals),
})

const TaskEndSnapshotPayload = Schema.Struct({
  task_id: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  status: Schema.optional(TaskStatus),
  estimate_needed: Schema.optional(Schema.Boolean),
  task_class: Schema.optional(Schema.Literals(TaskClasses)),
  task_summary: Schema.optional(Schema.String),
  start_timestamp: Schema.optional(Schema.String),
  end_timestamp: Schema.optional(Schema.String),
  wall_clock_ms: Schema.optional(Schema.Int),
  session_totals: SessionTotals,
  start_session_totals: Schema.optional(SessionTotals),
  subagent_totals: Schema.optional(SessionTotals),
  start_subagent_totals: Schema.optional(SessionTotals),
  combined_totals: Schema.optional(SessionTotals),
  start_combined_totals: Schema.optional(SessionTotals),
  session_delta: Schema.optional(SessionTotals),
  task_delta: TaskDelta,
  subagent_delta: Schema.optional(SessionTotals),
  combined_delta: Schema.optional(TaskDelta),
  verification_performed: Schema.optional(Schema.mutable(Schema.Array(Schema.Record(Schema.String, Schema.Any)))),
  slow_commands_observed: Schema.optional(Schema.mutable(Schema.Array(Schema.Record(Schema.String, Schema.Any)))),
  metrics_reset_detected: Schema.optional(Schema.Boolean),
  error_message: Schema.optional(Schema.String),
})

export const TaskEstimationEvent = Schema.Struct({
  schema: Schema.Literal("opencode.task_estimation.v1"),
  event_type: Schema.Literals(EventTypes),
  task_id: Schema.String,
  timestamp: Schema.optional(Schema.String),
  session_id: Schema.optional(Schema.String),
  time: Time,
  project: Project,
  session: EventSession,
  request: Request,
  payload: Schema.Union([EstimatePayload, ActualsPayload, TaskStartSnapshotPayload, TaskEndSnapshotPayload]),
})
export type TaskEstimationEvent = Schema.Schema.Type<typeof TaskEstimationEvent>

export const TaskEstimationInput = Schema.Struct({
  event_type: Schema.Literals(["estimate_classified", "estimate_logged"]),
  task_id: Schema.optional(
    Schema.String.annotate({ description: "Stable task id, for example task_20260518T142233Z_a8f3c1" }),
  ),
  user_message_id: Schema.optional(Schema.String).annotate({ description: "Current user message id, if known" }),
  estimate_needed: Schema.Boolean,
  trigger_reasons: Schema.mutable(Schema.Array(Schema.String)),
  task_class: Schema.Literals(TaskClasses),
  task_summary: Schema.optional(Schema.String),
  task_size_class: Schema.optional(Schema.Literals(TaskClasses)),
  quality_bar: Schema.optional(Schema.Literals(QualityBars)),
  runtime_mode: Schema.optional(Schema.Literals(RuntimeModes)),
  classification_confidence: Schema.optional(Schema.Literals(["low", "medium", "high"])),
  estimate_version: Schema.optional(Schema.String),
  prediction: Schema.optional(Prediction),
  ranges: Schema.optional(
    Schema.Struct({
      wall_clock_minutes: Range,
      assistant_model_calls: Range,
      tool_cycles: Range,
      fresh_tokens: Range,
      cache_read_inclusive_tokens: Range,
    }),
  ),
  assumptions: Schema.optional(Schema.mutable(Schema.Array(Schema.String))),
  subagent_assumption: Schema.optional(Schema.String),
  verification_assumption: Schema.optional(Schema.String),
  slow_command_assumption: Schema.optional(Schema.String),
  main_uncertainty: Schema.optional(Schema.String),
  estimation_features: Schema.optional(EstimationFeatures),
})
export type TaskEstimationInput = Schema.Schema.Type<typeof TaskEstimationInput>

type ActiveTask = {
  taskID: string
  userMessageID: string
  startedAt: number
  startedMonotonic: number
  startTimestamp: string
  startSessionTotals?: SessionTotalsValue
  startSubagentTotals?: SessionTotalsValue
  startSubagentTotalsBySession?: Record<string, SessionTotalsValue>
  estimateNeeded: boolean
  taskClass: (typeof TaskClasses)[number]
  taskSummary?: string
  estimateLogged: boolean
}

type SessionTotalsValue = Schema.Schema.Type<typeof SessionTotals>

export type ActualsSummary = {
  taskID: string
  estimateLogged: boolean
  status: "completed" | "interrupted" | "failed" | "cancelled" | "unknown"
  taskSummary?: string
  wallClockMs: number
  sessionDelta: SessionTotalsValue
  subagentDelta: SessionTotalsValue
  combinedDelta: SessionTotalsValue
  verificationCount: number
  slowCommandCount: number
}

const active = new Map<SessionID, ActiveTask>()

function elapsedWallClockMs(startedMonotonic: number) {
  return Math.max(0, Math.round(performance.now() - startedMonotonic))
}

export function createTaskID() {
  return `task_${new Date()
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z")}_${randomUUID().slice(0, 8)}`
}

function zeroTotals(): SessionTotalsValue {
  return {
    assistant_model_calls: 0,
    tool_cycles: 0,
    fresh_tokens: 0,
    cache_read_inclusive_tokens: 0,
    input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    cache_read_tokens: 0,
    cache_write_tokens: 0,
    execution_ms: 0,
  }
}

function addTotals(...totals: SessionTotalsValue[]): SessionTotalsValue {
  return totals.reduce(
    (acc, total) => ({
      assistant_model_calls: acc.assistant_model_calls + total.assistant_model_calls,
      tool_cycles: acc.tool_cycles + total.tool_cycles,
      fresh_tokens: acc.fresh_tokens + total.fresh_tokens,
      cache_read_inclusive_tokens: acc.cache_read_inclusive_tokens + total.cache_read_inclusive_tokens,
      input_tokens: acc.input_tokens + total.input_tokens,
      output_tokens: acc.output_tokens + total.output_tokens,
      reasoning_tokens: acc.reasoning_tokens + total.reasoning_tokens,
      cache_read_tokens: acc.cache_read_tokens + total.cache_read_tokens,
      cache_write_tokens: (acc.cache_write_tokens ?? 0) + (total.cache_write_tokens ?? 0),
      execution_ms: acc.execution_ms + total.execution_ms,
    }),
    zeroTotals(),
  )
}

function subtractTotals(end: SessionTotalsValue, start: SessionTotalsValue): SessionTotalsValue {
  return {
    assistant_model_calls: Math.max(0, end.assistant_model_calls - start.assistant_model_calls),
    tool_cycles: Math.max(0, end.tool_cycles - start.tool_cycles),
    fresh_tokens: Math.max(0, end.fresh_tokens - start.fresh_tokens),
    cache_read_inclusive_tokens: Math.max(0, end.cache_read_inclusive_tokens - start.cache_read_inclusive_tokens),
    input_tokens: Math.max(0, end.input_tokens - start.input_tokens),
    output_tokens: Math.max(0, end.output_tokens - start.output_tokens),
    reasoning_tokens: Math.max(0, end.reasoning_tokens - start.reasoning_tokens),
    cache_read_tokens: Math.max(0, end.cache_read_tokens - start.cache_read_tokens),
    cache_write_tokens: Math.max(0, (end.cache_write_tokens ?? 0) - (start.cache_write_tokens ?? 0)),
    execution_ms: Math.max(0, end.execution_ms - start.execution_ms),
  }
}

function totalsReset(end: SessionTotalsValue, start: SessionTotalsValue) {
  return Object.keys(zeroTotals()).some((key) => {
    const field = key as keyof SessionTotalsValue
    return (end[field] ?? 0) < (start[field] ?? 0)
  })
}

function taskDelta(totals: SessionTotalsValue, wallClockMs: number) {
  return {
    ...totals,
    wall_clock_ms: wallClockMs,
  }
}

function sessionTotals(messages: MessageV2.WithParts[]): SessionTotalsValue {
  const assistants = messages.filter((msg) => msg.info.role === "assistant")
  const stepFinishParts = assistants.flatMap((msg) => msg.parts.filter((part) => part.type === "step-finish"))
  const toolParts = assistants.flatMap((msg) => msg.parts.filter((part) => part.type === "tool"))
  const tokens = stepFinishParts.reduce(
    (acc, part) => {
      acc.input += part.tokens.input
      acc.output += part.tokens.output
      acc.reasoning += part.tokens.reasoning
      acc.cache_read += part.tokens.cache.read
      acc.cache_write += part.tokens.cache.write
      return acc
    },
    { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
  )
  const executionMs = toolParts.reduce((acc, part) => {
    if (!("time" in part.state) || !("end" in part.state.time)) return acc
    return acc + Math.max(0, part.state.time.end - part.state.time.start)
  }, 0)
  const fresh = tokens.input + tokens.output + tokens.reasoning
  return {
    assistant_model_calls: stepFinishParts.length || assistants.length,
    tool_cycles: assistants.filter((msg) => msg.parts.some((part) => part.type === "tool")).length,
    fresh_tokens: fresh,
    cache_read_inclusive_tokens: fresh + tokens.cache_read,
    input_tokens: tokens.input,
    output_tokens: tokens.output,
    reasoning_tokens: tokens.reasoning,
    cache_read_tokens: tokens.cache_read,
    cache_write_tokens: tokens.cache_write,
    execution_ms: Math.round(executionMs),
  }
}

const collectSubagentTotals = Effect.fn("TaskEstimation.collectSubagentTotals")(function* (input: {
  sessions: Session.Interface
  sessionID: SessionID
}) {
  const children = yield* input.sessions.children(input.sessionID)
  const totalsBySession: Record<string, SessionTotalsValue> = {}
  const childTotals: SessionTotalsValue[] = []
  for (const child of children) {
    const messages = yield* input.sessions.messages({ sessionID: child.id })
    const totals = sessionTotals(messages)
    totalsBySession[child.id] = totals
    childTotals.push(totals)
  }
  return {
    children,
    totalsBySession,
    totals: addTotals(...childTotals),
  }
})

function verificationKind(command: string) {
  const lower = command.toLowerCase()
  if (/\b(lint|eslint|biome)\b/.test(lower)) return "lint"
  if (/\b(typecheck|tsc)\b/.test(lower)) return "typecheck"
  if (/\b(build|vite build|next build)\b/.test(lower)) return "build"
  if (/\b(test|vitest|jest|playwright|bun test|pytest|go test|cargo test)\b/.test(lower)) return "unit_test"
  if (/\b(migrate|migration)\b/.test(lower)) return "migration_check"
}

export const append = Effect.fn("TaskEstimation.append")(function* (input: {
  sessionID: SessionID
  event: TaskEstimationEvent
}) {
  const { sessionID, event } = input
  const decoded = yield* Schema.decodeUnknownEffect(TaskEstimationEvent)(event).pipe(Effect.option)
  if (decoded._tag === "None") return
  const dir = path.join(Global.Path.data, "metrics", "sessions")
  const file = path.join(dir, `${sessionID}.jsonl`)
  yield* Effect.tryPromise({
    try: async () => {
      await fs.mkdir(dir, { recursive: true })
      await fs.appendFile(file, `${JSON.stringify(event)}\n`, "utf8")
    },
    catch: (cause) => cause,
  }).pipe(Effect.ignore)
})

const envelope = Effect.fn("TaskEstimation.envelope")(function* (input: {
  sessionID: SessionID
  taskID: string
  userMessageID: string
  assistantMessageID: string | null
  eventType: (typeof EventTypes)[number]
  payload: TaskEstimationEvent["payload"]
  sessions: Session.Interface
}) {
  const session = yield* input.sessions.get(input.sessionID)
  const now = Date.now()
  return {
    schema: "opencode.task_estimation.v1" as const,
    event_type: input.eventType,
    task_id: input.taskID,
    timestamp: new Date(now).toISOString(),
    session_id: session.id,
    time: {
      created: new Date(now).toISOString(),
      epochMs: now,
    },
    project: {
      id: session.projectID,
      directory: session.directory,
      ...(session.workspaceID ? { workspaceID: session.workspaceID } : {}),
    },
    session: {
      id: session.id,
      title: session.title,
    },
    request: {
      user_message_id: input.userMessageID,
      assistant_message_start_id: input.assistantMessageID,
    },
    payload: input.payload,
  } satisfies TaskEstimationEvent
})

export const logAssistantEvent = (input: {
  sessions: Session.Interface
  sessionID: SessionID
  assistantMessageID: string
  input: TaskEstimationInput
}): Effect.Effect<string> =>
  Effect.gen(function* () {
    const msgs = yield* input.sessions.messages({ sessionID: input.sessionID })
    const userMessageID =
      input.input.user_message_id ?? msgs.findLast((msg) => msg.info.role === "user")?.info.id ?? "unknown"
    const existing = active.get(input.sessionID)
    const taskID =
      input.input.event_type === "estimate_classified"
        ? (input.input.task_id ?? createTaskID())
        : (input.input.task_id ?? existing?.taskID ?? createTaskID())
    const { event_type, task_id: _taskID, user_message_id: _userMessageID, ...payload } = input.input
    const estimatePayload =
      event_type === "estimate_logged"
        ? {
            ...payload,
            task_size_class: payload.task_size_class ?? payload.task_class,
            prediction:
              payload.prediction ??
              (payload.ranges
                ? {
                    wall_clock_ms: {
                      min: payload.ranges.wall_clock_minutes.min * 60_000,
                      max: payload.ranges.wall_clock_minutes.max * 60_000,
                    },
                    assistant_model_calls: payload.ranges.assistant_model_calls,
                    tool_cycles: payload.ranges.tool_cycles,
                    fresh_tokens: payload.ranges.fresh_tokens,
                    cache_read_inclusive_tokens: payload.ranges.cache_read_inclusive_tokens,
                  }
                : undefined),
          }
        : payload
    const event = yield* envelope({
      sessionID: input.sessionID,
      taskID,
      userMessageID,
      assistantMessageID: input.assistantMessageID,
      eventType: event_type,
      payload: estimatePayload,
      sessions: input.sessions,
    })
    yield* append({ sessionID: input.sessionID, event })
    if (input.input.event_type === "estimate_classified") {
      const startSessionTotals = sessionTotals(msgs)
      const startSubagents = yield* collectSubagentTotals({ sessions: input.sessions, sessionID: input.sessionID })
      const startedAt = Date.now()
      const startTimestamp = new Date(startedAt).toISOString()
      const startedMonotonic = performance.now()
      active.set(input.sessionID, {
        taskID,
        userMessageID,
        startedAt,
        startedMonotonic,
        startTimestamp,
        startSessionTotals,
        startSubagentTotals: startSubagents.totals,
        startSubagentTotalsBySession: startSubagents.totalsBySession,
        estimateNeeded: payload.estimate_needed,
        taskClass: payload.task_class,
        taskSummary: payload.task_summary,
        estimateLogged: false,
      })
      const startEvent = yield* envelope({
        sessionID: input.sessionID,
        taskID,
        userMessageID,
        assistantMessageID: input.assistantMessageID,
        eventType: "task_start_snapshot",
        payload: {
          task_id: taskID,
          session_id: input.sessionID,
          estimate_needed: payload.estimate_needed,
          task_class: payload.task_class,
          ...(payload.task_summary ? { task_summary: payload.task_summary } : {}),
          start_timestamp: startTimestamp,
          session_totals: startSessionTotals,
          subagent_totals: startSubagents.totals,
          combined_totals: addTotals(startSessionTotals, startSubagents.totals),
        },
        sessions: input.sessions,
      })
      yield* append({ sessionID: input.sessionID, event: startEvent })
    }
    if (input.input.event_type === "estimate_logged" && existing?.taskID === taskID) {
      active.set(input.sessionID, { ...existing, estimateLogged: true })
    }
    return taskID
  }).pipe(Effect.catchCause(() => Effect.succeed(input.input.task_id ?? createTaskID())))

export const logActuals = (input: {
  sessions: Session.Interface
  sessionID: SessionID
  completionStatus?: "completed" | "interrupted" | "failed" | "cancelled"
  errorMessage?: string
}): Effect.Effect<ActualsSummary | undefined> =>
  Effect.gen(function* () {
    const task = active.get(input.sessionID)
    if (!task) return undefined
    active.delete(input.sessionID)
    const msgs = yield* input.sessions.messages({ sessionID: input.sessionID })
    const endSessionTotals = sessionTotals(msgs)
    const endSubagents = yield* collectSubagentTotals({ sessions: input.sessions, sessionID: input.sessionID })
    const endTimestamp = new Date().toISOString()
    const wallClockMs = elapsedWallClockMs(task.startedMonotonic)
    const assistants = msgs.filter((msg) => msg.info.role === "assistant" && msg.info.parentID >= task.userMessageID)
    const subagentItems = endSubagents.children.map((child) => {
      const endTotals = endSubagents.totalsBySession[child.id] ?? zeroTotals()
      const startTotals = task.startSubagentTotalsBySession?.[child.id] ?? zeroTotals()
      return {
        sessionID: child.id,
        parentSessionID: input.sessionID,
        title: child.title,
        ...(child.agent ? { agent: child.agent } : {}),
        depth: 1,
        ...subtractTotals(endTotals, startTotals),
      }
    })
    const subagentDelta = addTotals(...subagentItems)
    const stepFinishParts = assistants.flatMap((msg) => msg.parts.filter((part) => part.type === "step-finish"))
    const shellParts = assistants.flatMap((msg) =>
      msg.parts.filter((part): part is MessageV2.ToolPart => part.type === "tool" && part.tool === "shell"),
    )
    const verification = shellParts.flatMap((part) => {
      const command = typeof part.state.input.command === "string" ? part.state.input.command : undefined
      const kind = command ? verificationKind(command) : undefined
      if (!command || !kind) return []
      const status = part.state.status === "completed" && part.state.metadata.exit === 0 ? "passed" : "failed"
      const duration =
        "time" in part.state && "end" in part.state.time ? part.state.time.end - part.state.time.start : undefined
      return [{ kind, command, status, ...(duration !== undefined ? { duration_ms: duration } : {}) }]
    })
    const slowCommands = shellParts.flatMap((part) => {
      const command = typeof part.state.input.command === "string" ? part.state.input.command : undefined
      const duration =
        "time" in part.state && "end" in part.state.time ? part.state.time.end - part.state.time.start : undefined
      if (!command || duration === undefined || duration < 30_000) return []
      return [{ command, duration_ms: duration }]
    })
    const toolCycles = assistants.filter((msg) => msg.parts.some((part) => part.type === "tool")).length
    const tokens = stepFinishParts.reduce(
      (acc, part) => {
        acc.input += part.tokens.input
        acc.output += part.tokens.output
        acc.reasoning += part.tokens.reasoning
        acc.cache_read += part.tokens.cache.read
        acc.cache_write += part.tokens.cache.write
        return acc
      },
      { input: 0, output: 0, reasoning: 0, cache_read: 0, cache_write: 0 },
    )
    const fresh = tokens.input + tokens.output + tokens.reasoning
    const event = yield* envelope({
      sessionID: input.sessionID,
      taskID: task.taskID,
      userMessageID: task.userMessageID,
      assistantMessageID: assistants[0]?.info.id ?? null,
      eventType: "actuals_logged",
      sessions: input.sessions,
      payload: {
        wall_clock_ms: wallClockMs,
        assistant_model_calls: stepFinishParts.length || assistants.length,
        tool_cycles: toolCycles,
        tokens: {
          fresh,
          cache_read_inclusive: fresh + tokens.cache_read,
          input: tokens.input,
          output: tokens.output,
          reasoning: tokens.reasoning,
          cache_read: tokens.cache_read,
          cache_write: tokens.cache_write,
        },
        subagents_used: {
          count: endSubagents.children.length,
          items: subagentItems,
          totals: subagentDelta,
        },
        verification_performed: verification,
        slow_commands_observed: slowCommands,
        ...(input.completionStatus && input.completionStatus !== "completed"
          ? { completion_status: input.completionStatus }
          : {}),
      },
    })
    yield* append({ sessionID: input.sessionID, event })
    const startSessionTotals = task.startSessionTotals ?? zeroTotals()
    const startSubagentTotals = task.startSubagentTotals ?? zeroTotals()
    const startCombinedTotals = addTotals(startSessionTotals, startSubagentTotals)
    const endCombinedTotals = addTotals(endSessionTotals, endSubagents.totals)
    const parentDelta = subtractTotals(endSessionTotals, startSessionTotals)
    const combinedTotalsDelta = subtractTotals(endCombinedTotals, startCombinedTotals)
    const status: ActualsSummary["status"] = input.completionStatus ?? "unknown"
    const metricsResetDetected =
      totalsReset(endSessionTotals, startSessionTotals) ||
      totalsReset(endSubagents.totals, startSubagentTotals) ||
      totalsReset(endCombinedTotals, startCombinedTotals)
    const endEvent = yield* envelope({
      sessionID: input.sessionID,
      taskID: task.taskID,
      userMessageID: task.userMessageID,
      assistantMessageID: assistants[0]?.info.id ?? null,
      eventType: "task_end_snapshot",
      sessions: input.sessions,
      payload: {
        task_id: task.taskID,
        session_id: input.sessionID,
        status,
        estimate_needed: task.estimateNeeded,
        task_class: task.taskClass,
        ...(task.taskSummary ? { task_summary: task.taskSummary } : {}),
        start_timestamp: task.startTimestamp,
        end_timestamp: endTimestamp,
        wall_clock_ms: wallClockMs,
        start_session_totals: startSessionTotals,
        session_totals: endSessionTotals,
        start_subagent_totals: startSubagentTotals,
        subagent_totals: endSubagents.totals,
        start_combined_totals: startCombinedTotals,
        combined_totals: endCombinedTotals,
        session_delta: parentDelta,
        task_delta: taskDelta(parentDelta, wallClockMs),
        subagent_delta: subagentDelta,
        combined_delta: taskDelta(combinedTotalsDelta, wallClockMs),
        verification_performed: verification,
        slow_commands_observed: slowCommands,
        ...(metricsResetDetected ? { metrics_reset_detected: true } : {}),
        ...(input.errorMessage && input.completionStatus !== "completed" ? { error_message: input.errorMessage } : {}),
      },
    })
    yield* append({ sessionID: input.sessionID, event: endEvent })
    return {
      taskID: task.taskID,
      estimateLogged: task.estimateLogged,
      status,
      taskSummary: task.taskSummary,
      wallClockMs,
      sessionDelta: parentDelta,
      subagentDelta,
      combinedDelta: combinedTotalsDelta,
      verificationCount: verification.length,
      slowCommandCount: slowCommands.length,
    }
  }).pipe(Effect.catchCause(() => Effect.succeed(undefined)))

export * as TaskEstimation from "./task-estimation"
