import { describe, expect, test } from "bun:test"
import { Effect, Schema } from "effect"
import { Global } from "@opencode-ai/core/global"
import { TaskEstimation } from "@/metrics/task-estimation"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

const base = {
  schema: "opencode.task_estimation.v1",
  task_id: "task_20260518T142233Z_a8f3c1",
  time: {
    created: "2026-05-18T14:22:33.000Z",
    epochMs: 1779114153000,
  },
  project: {
    id: "proj_123",
    directory: "/tmp/project",
    workspaceID: "wrk_123",
  },
  session: {
    id: "ses_123",
    title: "Example task",
  },
  request: {
    user_message_id: "msg_123",
    assistant_message_start_id: null,
  },
}

const totals = {
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

function user(id = "msg_001") {
  return { info: { id, role: "user" }, parts: [] } as any
}

function assistant(input: { id?: string; parentID?: string; inputTokens?: number; outputTokens?: number }) {
  const inputTokens = input.inputTokens ?? 100
  const outputTokens = input.outputTokens ?? 25
  return {
    info: { id: input.id ?? "msg_002", role: "assistant", parentID: input.parentID ?? "msg_001" },
    parts: [
      {
        type: "step-finish",
        tokens: {
          input: inputTokens,
          output: outputTokens,
          reasoning: 5,
          cache: { read: 10, write: 2 },
        },
      },
    ],
  } as any
}

async function withMetricsLog<T>(fn: (input: { dir: string; file: string }) => Promise<T>) {
  const previous = Global.Path.data
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-task-estimation-"))
  ;(Global.Path as { data: string }).data = dir
  try {
    return await fn({ dir, file: path.join(dir, "metrics", "sessions", "ses_123.jsonl") })
  } finally {
    ;(Global.Path as { data: string }).data = previous
    await fs.rm(dir, { recursive: true, force: true })
  }
}

async function readEvents(file: string) {
  const content = await fs.readFile(file, "utf8")
  return content
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as TaskEstimation.TaskEstimationEvent)
}

function fakeSessions(messages: any[], children: any[] = []) {
  return {
    get: () =>
      Effect.succeed({
        id: "ses_123",
        projectID: "proj_123",
        directory: "/tmp/project",
        workspaceID: "wrk_123",
        title: "Example task",
      }),
    messages: ({ sessionID }: { sessionID: string }) =>
      Effect.succeed(
        sessionID === "ses_123" ? messages : (children.find((child) => child.id === sessionID)?.messages ?? []),
      ),
    children: () => Effect.succeed(children),
  } as any
}

describe("task estimation schema", () => {
  test("accepts estimate_logged events", () => {
    const event = Schema.decodeUnknownSync(TaskEstimation.TaskEstimationEvent)({
      ...base,
      event_type: "estimate_logged",
      payload: {
        estimate_version: "2026-05-18.1",
        estimate_needed: true,
        trigger_reasons: ["likely_multi_file_change"],
        task_class: "moderate_implementation",
        ranges: {
          wall_clock_minutes: { min: 8, max: 18 },
          assistant_model_calls: { min: 15, max: 30 },
          tool_cycles: { min: 8, max: 18 },
          fresh_tokens: { min: 45000, max: 120000 },
          cache_read_inclusive_tokens: { min: 400000, max: 1200000 },
        },
        assumptions: ["Implementation path is discoverable."],
        subagent_assumption: "No subagents expected.",
        verification_assumption: "Focused verification expected.",
        slow_command_assumption: "No slow commands expected.",
        main_uncertainty: "Affected files may be broader than expected.",
        estimation_features: {
          subagents_expected: 1,
        },
      },
    })

    expect(event.event_type).toBe("estimate_logged")
  })

  test("accepts task snapshot events with task deltas", () => {
    const start = Schema.decodeUnknownSync(TaskEstimation.TaskEstimationEvent)({
      ...base,
      event_type: "task_start_snapshot",
      payload: {
        session_totals: {
          assistant_model_calls: 2,
          tool_cycles: 1,
          fresh_tokens: 1000,
          cache_read_inclusive_tokens: 1200,
          input_tokens: 700,
          output_tokens: 200,
          reasoning_tokens: 100,
          cache_read_tokens: 200,
          cache_write_tokens: 50,
          execution_ms: 300,
        },
        subagent_totals: {
          assistant_model_calls: 1,
          tool_cycles: 1,
          fresh_tokens: 500,
          cache_read_inclusive_tokens: 700,
          input_tokens: 300,
          output_tokens: 150,
          reasoning_tokens: 50,
          cache_read_tokens: 200,
          cache_write_tokens: 25,
          execution_ms: 100,
        },
        combined_totals: {
          assistant_model_calls: 3,
          tool_cycles: 2,
          fresh_tokens: 1500,
          cache_read_inclusive_tokens: 1900,
          input_tokens: 1000,
          output_tokens: 350,
          reasoning_tokens: 150,
          cache_read_tokens: 400,
          cache_write_tokens: 75,
          execution_ms: 400,
        },
      },
    })

    const end = Schema.decodeUnknownSync(TaskEstimation.TaskEstimationEvent)({
      ...base,
      event_type: "task_end_snapshot",
      payload: {
        session_totals: {
          assistant_model_calls: 4,
          tool_cycles: 3,
          fresh_tokens: 2200,
          cache_read_inclusive_tokens: 3000,
          input_tokens: 1500,
          output_tokens: 500,
          reasoning_tokens: 200,
          cache_read_tokens: 800,
          cache_write_tokens: 125,
          execution_ms: 900,
        },
        subagent_totals: {
          assistant_model_calls: 3,
          tool_cycles: 2,
          fresh_tokens: 1200,
          cache_read_inclusive_tokens: 1800,
          input_tokens: 800,
          output_tokens: 300,
          reasoning_tokens: 100,
          cache_read_tokens: 600,
          cache_write_tokens: 75,
          execution_ms: 500,
        },
        combined_totals: {
          assistant_model_calls: 7,
          tool_cycles: 5,
          fresh_tokens: 3400,
          cache_read_inclusive_tokens: 4800,
          input_tokens: 2300,
          output_tokens: 800,
          reasoning_tokens: 300,
          cache_read_tokens: 1400,
          cache_write_tokens: 200,
          execution_ms: 1400,
        },
        task_delta: {
          assistant_model_calls: 2,
          tool_cycles: 2,
          fresh_tokens: 1200,
          cache_read_inclusive_tokens: 1800,
          input_tokens: 800,
          output_tokens: 300,
          reasoning_tokens: 100,
          cache_read_tokens: 600,
          cache_write_tokens: 75,
          execution_ms: 600,
          wall_clock_ms: 1500,
        },
        subagent_delta: {
          assistant_model_calls: 2,
          tool_cycles: 1,
          fresh_tokens: 700,
          cache_read_inclusive_tokens: 1100,
          input_tokens: 500,
          output_tokens: 150,
          reasoning_tokens: 50,
          cache_read_tokens: 400,
          cache_write_tokens: 50,
          execution_ms: 400,
        },
        combined_delta: {
          assistant_model_calls: 4,
          tool_cycles: 3,
          fresh_tokens: 1900,
          cache_read_inclusive_tokens: 2900,
          input_tokens: 1300,
          output_tokens: 450,
          reasoning_tokens: 150,
          cache_read_tokens: 1000,
          cache_write_tokens: 125,
          execution_ms: 1000,
          wall_clock_ms: 1500,
        },
        status: "completed",
      },
    })

    expect(start.event_type).toBe("task_start_snapshot")
    expect(end.event_type).toBe("task_end_snapshot")
  })

  test("accepts actuals with populated subagent usage", () => {
    const event = Schema.decodeUnknownSync(TaskEstimation.TaskEstimationEvent)({
      ...base,
      event_type: "actuals_logged",
      payload: {
        wall_clock_ms: 42000,
        assistant_model_calls: 4,
        tool_cycles: 3,
        tokens: {
          fresh: 10000,
          cache_read_inclusive: 50000,
          input: 7000,
          output: 2500,
          reasoning: 500,
          cache_read: 40000,
          cache_write: 100,
        },
        subagents_used: {
          count: 1,
          items: [
            {
              sessionID: "ses_child_1",
              parentSessionID: "ses_123",
              title: "Explore logging implementation",
              agent: "explore",
              depth: 1,
              assistant_model_calls: 6,
              tool_cycles: 5,
              fresh_tokens: 28000,
              cache_read_inclusive_tokens: 260000,
              input_tokens: 23000,
              output_tokens: 3000,
              reasoning_tokens: 2000,
              cache_read_tokens: 232000,
              cache_write_tokens: 0,
              execution_ms: 42000,
            },
          ],
          totals: {
            assistant_model_calls: 6,
            tool_cycles: 5,
            fresh_tokens: 28000,
            cache_read_inclusive_tokens: 260000,
            input_tokens: 23000,
            output_tokens: 3000,
            reasoning_tokens: 2000,
            cache_read_tokens: 232000,
            cache_write_tokens: 0,
            execution_ms: 42000,
          },
        },
        verification_performed: [],
        slow_commands_observed: [],
      },
    })

    expect(event.event_type).toBe("actuals_logged")
  })

  test("logs start and end snapshots for classified tasks with and without visible estimates", async () => {
    await withMetricsLog(async ({ file }) => {
      for (const estimateNeeded of [true, false]) {
        const messages = [user(`msg_${estimateNeeded ? "true" : "false"}`)]
        const sessions = fakeSessions(messages)
        const taskID = `task_${estimateNeeded ? "needed" : "skipped"}`

        await Effect.runPromise(
          TaskEstimation.logAssistantEvent({
            sessions,
            sessionID: "ses_123" as any,
            assistantMessageID: "asst_start",
            input: {
              event_type: "estimate_classified",
              task_id: taskID,
              user_message_id: messages[0].info.id,
              estimate_needed: estimateNeeded,
              trigger_reasons: [],
              task_class: estimateNeeded ? "small_implementation" : "tiny_focused_edit",
              task_summary: estimateNeeded ? "Estimated task" : "Skipped estimate task",
            },
          }),
        )

        if (estimateNeeded) {
          await Effect.runPromise(
            TaskEstimation.logAssistantEvent({
              sessions,
              sessionID: "ses_123" as any,
              assistantMessageID: "asst_start",
              input: {
                event_type: "estimate_logged",
                task_id: taskID,
                user_message_id: messages[0].info.id,
                estimate_needed: true,
                trigger_reasons: ["expected_code_change"],
                task_class: "small_implementation",
                task_summary: "Estimated task",
              },
            }),
          )
        }

        messages.push(assistant({ parentID: messages[0].info.id, inputTokens: estimateNeeded ? 200 : 50 }))
        await Effect.runPromise(
          TaskEstimation.logActuals({ sessions, sessionID: "ses_123" as any, completionStatus: "completed" }),
        )
      }

      const events = await readEvents(file)
      expect(events.filter((event) => event.event_type === "estimate_classified")).toHaveLength(
        events.filter((event) => event.event_type === "task_end_snapshot").length,
      )
      for (const taskID of ["task_needed", "task_skipped"]) {
        const start = events.find((event) => event.task_id === taskID && event.event_type === "task_start_snapshot")
        const end = events.find((event) => event.task_id === taskID && event.event_type === "task_end_snapshot")
        expect(start).toBeDefined()
        expect(end).toBeDefined()
        expect((end!.payload as any).combined_delta).toEqual({
          ...totals,
          assistant_model_calls: 1,
          fresh_tokens: taskID === "task_needed" ? 230 : 80,
          cache_read_inclusive_tokens: taskID === "task_needed" ? 240 : 90,
          input_tokens: taskID === "task_needed" ? 200 : 50,
          output_tokens: 25,
          reasoning_tokens: 5,
          cache_read_tokens: 10,
          cache_write_tokens: 2,
          wall_clock_ms: (end!.payload as any).combined_delta.wall_clock_ms,
        })
      }
    })
  })

  test("logs task_end_snapshot for failed classified tasks", async () => {
    await withMetricsLog(async ({ file }) => {
      const messages = [user("msg_failed")]
      const sessions = fakeSessions(messages)

      await Effect.runPromise(
        TaskEstimation.logAssistantEvent({
          sessions,
          sessionID: "ses_123" as any,
          assistantMessageID: "asst_start",
          input: {
            event_type: "estimate_classified",
            task_id: "task_failed",
            user_message_id: "msg_failed",
            estimate_needed: false,
            trigger_reasons: [],
            task_class: "tiny_focused_edit",
            task_summary: "Failing task",
          },
        }),
      )

      await Effect.runPromise(
        TaskEstimation.logActuals({
          sessions,
          sessionID: "ses_123" as any,
          completionStatus: "failed",
          errorMessage: "simulated failure",
        }),
      )

      const events = await readEvents(file)
      const end = events.find((event) => event.task_id === "task_failed" && event.event_type === "task_end_snapshot")
      expect(end).toBeDefined()
      expect((end!.payload as any).status).toBe("failed")
      expect((end!.payload as any).error_message).toBe("simulated failure")
    })
  })

  test("rejects reserved future event types in v1", () => {
    expect(() =>
      Schema.decodeUnknownSync(TaskEstimation.TaskEstimationEvent)({
        ...base,
        event_type: "estimate_revised",
        payload: {
          estimate_needed: true,
          trigger_reasons: [],
          task_class: "small_implementation",
        },
      }),
    ).toThrow()
  })
})
